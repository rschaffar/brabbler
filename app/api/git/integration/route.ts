import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { gitExecEnv } from "@/lib/git-exec";
import { beginGitAction, failGitAction, gitActionFailureResult, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError } from "@/lib/git-action-controller";
import { finishHumanGitAction, humanGitActionSink, HUMAN_GIT_RECOVERY_WARNING, HumanGitCandidateError, HumanGitSessionChangedError, keepHumanGitCandidate, readHumanGitSessionManager, takeHumanGitCandidate } from "@/lib/git-action-human";
import { GIT_ACTION_ID_PATTERN } from "@/lib/git-action-types";
import { acquireGitCheckoutGate, isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { confirmIntegration, prepareIntegration } from "@/lib/git-integration";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent, GitOperationRecoveryError, type GitOperationReservation } from "@/lib/git-operation-admission";
import { selectGitProjectResources } from "@/lib/git-project-resources";
import { reviewGitBranches, type GitReview } from "@/lib/git-review";
import { inspectGitVerificationReceipts, runGitVerification } from "@/lib/git-verification";
import { readSessionGitWorkflow } from "@/lib/git-workflow-policy";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, ManagedGitAccessError, watchManagedGitAccess } from "@/lib/git-workflow-access";
import { samePath, toNativePath } from "@/lib/paths";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
const exec = promisify(execFile);
const MAX_BODY = 4096;
const RECEIPT_TTL = 15 * 60_000;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function validId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }

async function allowed(cwd: string, roots: Awaited<ReturnType<typeof getAllowedFileRoots>>) {
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) return false;
  return statSync(cwd).isDirectory() && samePath(cwd, realpathSync(cwd));
}

// The browser never names a checkout or a ref. Resolve the target from Git's registered worktrees.
async function targetCheckout(cwd: string, branch: string): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "worktree", "list", "--porcelain", "-z"], {
    encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 1024 * 1024,
  });
  let location = "";
  let target = "";
  for (const line of stdout.split("\0")) {
    if (line.startsWith("worktree ")) location = toNativePath(line.slice(9));
    if (line === `branch refs/heads/${branch}`) {
      if (target) throw new Error("ambiguous target");
      target = location;
    }
  }
  if (!target || samePath(target, cwd)) throw new Error("target checkout unavailable");
  return target;
}

async function session(id: string, action?: "checks" | "integration") {
  const file = await resolveSessionPath(id);
  if (!file) return { response: error("Session not found", 404) };
  const header = readSessionHeader(file);
  if (!header || header.id !== id || !header.cwd) return { response: error("Session identity mismatch", 409) };
  const cwd = header.cwd;
  const roots = await getAllowedFileRoots();
  if (!await allowed(cwd, roots)) return { response: error("Checkout not allowed", 403) };
  const scope = { sessionId: id, sessionFile: file, cwd };
  const policy = async () => {
    const value = readHumanGitSessionManager(scope);
    const state = await assertManagedGitAction(cwd, value.getEntries() as SessionEntry[], "integration", "human");
    await assertManagedGitWorkspace(state, cwd);
    // GET is read-only review. Saved Deny gates only executable POST stages.
    if (action) await assertManagedGitProjectDenial(cwd, { sessionId: id, sessionFile: file, sessionCwd: cwd }, action);
    return readSessionGitWorkflow(value.getEntries() as SessionEntry[]);
  };
  const saved = await policy();
  if (!saved?.integration || saved.integration.method !== "merge") {
    return { response: error("Saved merge target required", 409) };
  }
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "symbolic-ref", "--quiet", "HEAD"], {
    encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096,
  });
  const ref = stdout.trim();
  if (!ref.startsWith("refs/heads/") || ref.length <= 11) return { response: error("Feature checkout required", 409) };
  const featureBranch = ref.slice("refs/heads/".length);
  if (saved.mode === "current" && saved.branch && saved.branch !== featureBranch) return { response: error("Feature checkout changed", 409) };
  const targetCwd = await targetCheckout(cwd, saved.integration.targetBranch);
  if (!await allowed(targetCwd, roots)) return { response: error("Target checkout not allowed", 403) };
  for (const checkout of [cwd, targetCwd]) {
    const { stdout: top } = await exec("git", ["--no-optional-locks", "-C", checkout, "rev-parse", "--show-toplevel"], {
      encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 4096,
    });
    if (!samePath(checkout, toNativePath(top.trim()))) return { response: error("Checkout root required", 409) };
  }
  const agentDir = getAgentDir();
  const trusted = () => getProjectTrustStatus(cwd, agentDir).trusted && getProjectTrustStatus(targetCwd, agentDir).trusted;
  if (!trusted()) return { response: error("Trust both projects before running checks or integration", 403) };
  return { cwd, targetCwd, featureBranch, agentDir, policy, saved, trusted, scope };
}

type Context = Extract<Awaited<ReturnType<typeof session>>, { cwd: string }>;
async function admissionSelection(context: Context) {
  const selection = await selectGitProjectResources(context.cwd);
  if (!samePath(selection.cwd, context.cwd) || selection.branch !== context.featureBranch ||
      !samePath(await targetCheckout(context.cwd, context.saved.integration!.targetBranch), context.targetCwd)) {
    throw new Error("Git resource selection changed");
  }
  return selection;
}
function matches(review: GitReview, r: ReturnType<typeof inspectGitVerificationReceipts>[number], context: Context, id: string) {
  return r.sessionId === id && samePath(r.cwd, context.cwd) && samePath(r.targetCwd, context.targetCwd) &&
    r.featureBranch === review.featureBranch && r.targetBranch === review.targetBranch &&
    r.featureOid === review.featureOid && r.targetOid === review.targetOid &&
    r.featureTreeOid === review.featureTreeOid && r.targetTreeOid === review.targetTreeOid &&
    r.mergeTreeOid === review.mergeTreeOid && r.policyDigest === createHash("sha256").update(JSON.stringify(context.saved)).digest("hex") &&
    r.exitStatus === 0 && Number.isSafeInteger(r.finishedAt) && r.finishedAt <= Date.now() && Date.now() - r.finishedAt <= RECEIPT_TTL &&
    r.checkIndex >= 0 && r.checkIndex < (context.saved.checks?.length ?? 0);
}
async function bodyOf(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > MAX_BODY) throw new Error("body too large");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error("body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get("sessionId");
    if ([...params.keys()].length !== 1 || !validId(id)) return error("Valid sessionId required", 400);
    const context = await session(id);
    if (context.response) return context.response;
    await assertGitOperationAdmission(await admissionSelection(context as Context), context.agentDir);
    const review = await reviewGitBranches(context.cwd!, context.featureBranch!, context.saved!.integration!.targetBranch);
    const receipts = inspectGitVerificationReceipts(id).filter((r) => matches(review, r, context as Context, id))
      .map((r) => ({ id: r.id, checkIndex: r.checkIndex, startedAt: r.startedAt, finishedAt: r.finishedAt, logDigest: r.logDigest }));
    return NextResponse.json({ review, checks: context.saved!.checks?.map((check, checkIndex) => ({ checkIndex, label: check.label })) ?? [], receipts });
  } catch { return error("Integration review unavailable", 409); }
}

export async function POST(req: Request) {
  let input: Record<string, unknown>;
  try { const parsed = await bodyOf(req); if (!record(parsed)) return error("Invalid request", 400); input = parsed; }
  catch { return error("Invalid or oversized JSON", 400); }
  const id = input.sessionId;
  if (!validId(id)) return error("Valid sessionId required", 400);
  const op = input.operation;
  if (!(op === "verify" && exact(input, ["sessionId", "operation", "checkIndex"]) && Number.isInteger(input.checkIndex) && (input.checkIndex as number) >= 0 && (input.checkIndex as number) < 12) &&
      !(op === "plan" && exact(input, ["sessionId", "operation", "receiptIds"]) && Array.isArray(input.receiptIds) && input.receiptIds.length > 0 && input.receiptIds.length <= 12 && input.receiptIds.every(validId) && new Set(input.receiptIds).size === input.receiptIds.length) &&
      !(op === "confirm" && exact(input, ["sessionId", "operation", "planId", "approvePlanId", "actionId"]) && validId(input.planId) && validId(input.approvePlanId)
        && typeof input.actionId === "string" && GIT_ACTION_ID_PATTERN.test(input.actionId))) {
    return error("Invalid integration request", 400);
  }
  try {
    const context = await session(id, op === "verify" ? "checks" : "integration");
    if (context.response) return context.response;
    const c = context as Context;
    if (!c.saved.checks?.length) return error("Saved verification checks required", 409);
    if (isGitCheckoutGated(c.cwd) || isGitCheckoutGated(c.targetCwd)) {
      return error("Checkout is busy with a Git transaction", 409);
    }
    const guard = async () => {
      req.signal.throwIfAborted();
      if (JSON.stringify(await c.policy()) !== JSON.stringify(c.saved)) throw new ManagedGitAccessError("Workflow policy changed; refresh review");
      const roots = await getAllowedFileRoots();
      if (!await allowed(c.cwd, roots) || !await allowed(c.targetCwd, roots) || !c.trusted()) {
        throw new ManagedGitAccessError("Checkout no longer available");
      }
      req.signal.throwIfAborted();
    };
    const sink = () => humanGitActionSink(c.scope);
    // Checks are arbitrary programs; reserve both checkouts throughout execution.
    // The same gate also serializes preview anchors with session moves/prompts.
    const release = acquireGitCheckoutGate([c.cwd, c.targetCwd]);
    try {
      await guard();
      if (op === "confirm") {
        if (input.planId !== input.approvePlanId) return error("Exact plan approval required", 400);
        const { handle, native } = takeHumanGitCandidate(c.scope, input.actionId as string,
          { kind: "integration", planId: input.planId as string, targetCwd: c.targetCwd });
        let applying = false;
        let reservation: GitOperationReservation | undefined;
        try {
          await guard();
          const result = await confirmIntegration(native.plan.planId, input.approvePlanId as string, id, async () => {
            await handle.update("executing", { decision: "approved" });
            await handle.update("executing", { intended: native.intended });
            await guard(); // after journal I/O, immediately before native checkout apply
            reservation = await beginSupervisedGitOperationIntent(await admissionSelection(c), handle.record.id, "integration");
            applying = true;
            return reservation;
          });
          // A partial result names the intended merge object, not a proven target ref update.
          const outcome = result.status === "integrated" ? { ...native.intended, ...result } : result;
          const recorded = await finishHumanGitAction(handle, result, outcome, result.status === "partial-state");
          if (result.status === "integrated" && !("recoveryRequired" in recorded)) {
            try { reservation?.resolve(); }
            catch { return NextResponse.json({ ...recorded, recoveryRequired: true, recoveryWarning: HUMAN_GIT_RECOVERY_WARNING }); }
          }
          return NextResponse.json(recorded);
        } catch (cause) {
          await failGitAction(handle, applying, req.signal, cause);
          if (applying && !(cause instanceof GitActionRecordingError)) cause = new GitActionApplyError(handle.record.id, handle.record.intended);
          if (cause instanceof GitActionRecordingError) return NextResponse.json({ ...gitActionFailureResult(cause)!.details,
            recoveryWarning: cause.message }, { status: 409 });
          if (cause instanceof GitOperationRecoveryError) return NextResponse.json({ actionId: handle.record.id,
            error: cause.message, recoveryRequired: true }, { status: 409 });
          return NextResponse.json({ actionId: handle.record.id, error: cause instanceof ManagedGitAccessError || cause instanceof HumanGitSessionChangedError ? cause.message
            : "Integration unavailable or plan stale; refresh review and prepare a new proposal" }, { status: 409 });
        } finally { handle.release(); }
      }
      await assertGitOperationAdmission(await admissionSelection(c), c.agentDir);
      const review = await reviewGitBranches(c.cwd, c.featureBranch, c.saved.integration!.targetBranch);
      if (op === "verify") {
        const checkIndex = input.checkIndex as number;
        const check = c.saved.checks[checkIndex];
        if (!check) return error("Saved check index required", 409);
        const watcher = await watchManagedGitAccess(guard, req.signal);
        try {
          const handle = await beginGitAction(sink(), "human", {
            ...snapshotGitActionCandidate({ kind: "checks", featureCwd: c.cwd, targetCwd: c.targetCwd,
              featureBranch: review.featureBranch, targetBranch: review.targetBranch, checks: [check] }),
            featureOid: review.featureOid, targetOid: review.targetOid, candidateTreeOid: review.mergeTreeOid,
          });
          let started = false;
          try {
            await handle.update("executing", { decision: "approved" });
            await guard();
            watcher.signal.throwIfAborted();
            started = true;
            const receipt = await runGitVerification({ sessionId: id, cwd: c.cwd, agentDir: c.agentDir, review, checkIndex, actionId: handle.record.id,
              getPolicy: async () => { await guard(); return c.saved; }, isTrusted: c.trusted, signal: watcher.signal });
            return NextResponse.json(await finishHumanGitAction(handle,
              { receipt: { id: receipt.id, checkIndex: receipt.checkIndex, startedAt: receipt.startedAt,
                finishedAt: receipt.finishedAt, logDigest: receipt.logDigest } },
              { status: "passed", featureOid: receipt.featureOid, targetOid: receipt.targetOid }));
          } catch {
            const cancelled = watcher.signal.aborted;
            const reason = started ? "Verification did not produce a successful receipt. Check commands can change files; inspect both checkouts."
              : "Verification was blocked before command execution.";
            let recoveryWarning;
            try { await handle.update(cancelled ? "cancelled" : started ? "failed" : "blocked",
              { reason, outcome: { status: cancelled ? "cancelled" : "failed" } }); }
            catch { recoveryWarning = HUMAN_GIT_RECOVERY_WARNING; }
            return NextResponse.json({ actionId: handle.record.id, error: cancelled ? `Verification cancelled. ${reason}` : reason,
              ...(recoveryWarning ? { recoveryRequired: true, recoveryWarning } : {}) }, { status: 409 });
          } finally { handle.release(); }
        } finally { watcher.dispose(); }
      }
      const ids = input.receiptIds as string[];
      const receipts = inspectGitVerificationReceipts(id);
      if (ids.length !== c.saved.checks.length || ids.some((rid, index) => {
        const r = receipts.find((receipt) => receipt.id === rid);
        return !r || r.checkIndex !== index || !matches(review, r, c, id);
      })) return error("Current successful receipts required for every saved check", 409);
      const plan = await prepareIntegration({ sessionId: id, cwd: c.cwd, agentDir: c.agentDir,
        featureBranch: c.featureBranch, receiptIds: ids, getPolicy: c.policy });
      // Capture identity from the already verified immutable merge object, not ambient author config.
      const { stdout } = await exec("git", ["--no-optional-locks", "-C", c.cwd, "show", "-s", "--format=%ae", plan.mergeOid, "--"], {
        encoding: "utf8", env: { ...gitExecEnv(), GIT_NO_REPLACE_OBJECTS: "1" }, timeout: 15000, maxBuffer: 4096,
      });
      const intended = { mergeOid: plan.mergeOid, tree: plan.review.mergeTreeOid, parents: [plan.review.targetOid, plan.review.featureOid],
        authorEmail: stdout.trim(), featureOid: plan.review.featureOid, targetOid: plan.review.targetOid, targetBranch: plan.review.targetBranch };
      const snapshot = { ...snapshotGitActionCandidate({ kind: "integration", featureCwd: c.cwd, targetCwd: c.targetCwd,
        plan, receipts: ids.map((rid) => receipts.find((r) => r.id === rid)!) }), checks: c.saved.checks, candidateTreeOid: plan.review.mergeTreeOid };
      await guard();
      const action = await keepHumanGitCandidate(sink(), c.scope, { kind: "integration", plan, targetCwd: c.targetCwd, intended }, snapshot);
      return NextResponse.json({ ...action, plan });
    } finally { release(); }
  } catch (cause) {
    if (cause instanceof ManagedGitAccessError || cause instanceof HumanGitCandidateError || cause instanceof HumanGitSessionChangedError) return error(cause.message, 409);
    // The engine's own fixed-prefix validation messages are sanitized; never
    // return raw Git stderr, check argv, private logs, or OS filesystem errors.
    if (cause instanceof Error && /^Git integration unavailable: [^\r\n]{1,160}$/.test(cause.message)) {
      return error(cause.message, 409);
    }
    return error("Integration unavailable; refresh review and inspect checkouts", 409);
  }
}
