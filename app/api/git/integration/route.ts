import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { gitExecEnv } from "@/lib/git-exec";
import { acquireGitCheckoutGate, isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { confirmIntegration, prepareIntegration } from "@/lib/git-integration";
import { reviewGitBranches, type GitReview } from "@/lib/git-review";
import { inspectGitVerificationReceipts, runGitVerification } from "@/lib/git-verification";
import { readSessionGitWorkflow } from "@/lib/git-workflow-policy";
import { assertManagedGitAction, assertManagedGitWorkspace, ManagedGitAccessError, watchManagedGitAccess } from "@/lib/git-workflow-access";
import { samePath, toNativePath } from "@/lib/paths";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { hasBusyRpcSessionForCwd } from "@/lib/rpc-manager";
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

async function session(id: string) {
  const file = await resolveSessionPath(id);
  if (!file) return { response: error("Session not found", 404) };
  const header = readSessionHeader(file);
  if (!header || header.id !== id || !header.cwd) return { response: error("Session identity mismatch", 409) };
  const cwd = header.cwd;
  const roots = await getAllowedFileRoots();
  if (!await allowed(cwd, roots)) return { response: error("Checkout not allowed", 403) };
  const policy = async () => {
    const manager = SessionManager.open(file, undefined);
    if (manager.getHeader()?.id !== id || manager.getHeader()?.cwd !== cwd) throw new Error("Session changed");
    const state = await assertManagedGitAction(cwd, manager.getEntries() as SessionEntry[], "integration", "human");
    await assertManagedGitWorkspace(state, cwd);
    return readSessionGitWorkflow(manager.getEntries() as SessionEntry[]);
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
  return { cwd, targetCwd, featureBranch, agentDir, policy, saved, trusted };
}

type Context = Extract<Awaited<ReturnType<typeof session>>, { cwd: string }>;
function idle(context: Context): boolean {
  return !hasBusyRpcSessionForCwd(context.cwd) && !hasBusyRpcSessionForCwd(context.targetCwd);
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
      !(op === "confirm" && exact(input, ["sessionId", "operation", "planId", "approvePlanId"]) && validId(input.planId) && validId(input.approvePlanId))) {
    return error("Invalid integration request", 400);
  }
  try {
    const context = await session(id);
    if (context.response) return context.response;
    const c = context as Context;
    if (!c.saved.checks?.length) return error("Saved verification checks required", 409);
    if (!idle(c) || isGitCheckoutGated(c.cwd) || isGitCheckoutGated(c.targetCwd)) {
      return error("Stop sessions in both checkouts before integration", 409);
    }
    if (op === "confirm") {
      if (input.planId !== input.approvePlanId) return error("Exact plan approval required", 400);
      // Reserve both checkouts before the final busy check. Newly submitted Pi Web
      // commands are rejected until the transaction has settled; external Git
      // writers remain subject to the engine's exact-state checks and recovery.
      const release = acquireGitCheckoutGate([c.cwd, c.targetCwd]);
      try {
        if (!c.trusted() || !idle(c) || !await allowed(c.cwd, await getAllowedFileRoots()) ||
            !await allowed(c.targetCwd, await getAllowedFileRoots())) return error("Checkout no longer available", 409);
        await c.policy();
        const result = await confirmIntegration(input.planId as string, input.approvePlanId as string, id);
        return NextResponse.json(result);
      } finally { release(); }
    }
    const review = await reviewGitBranches(c.cwd, c.featureBranch, c.saved.integration!.targetBranch);
    if (op === "verify") {
      // Saved checks are arbitrary project programs. Reserve both checkouts
      // throughout execution so a previously approved merge cannot apply
      // while another check is still reading or writing their files.
      const release = acquireGitCheckoutGate([c.cwd, c.targetCwd]);
      try {
        if (!idle(c) || !c.trusted()) return error("Checkout no longer available", 409);
        const watcher = await watchManagedGitAccess(() => c.policy(), req.signal);
        try {
          const receipt = await runGitVerification({ sessionId: id, cwd: c.cwd, agentDir: c.agentDir, review,
            checkIndex: input.checkIndex as number, getPolicy: c.policy, isTrusted: c.trusted, signal: watcher.signal });
          return NextResponse.json({ receipt: { id: receipt.id, checkIndex: receipt.checkIndex, startedAt: receipt.startedAt,
            finishedAt: receipt.finishedAt, logDigest: receipt.logDigest } });
        } finally { watcher.dispose(); }
      } finally { release(); }
    }
    const ids = input.receiptIds as string[];
    if (ids.length !== c.saved.checks!.length || ids.some((rid, index) => {
      const r = inspectGitVerificationReceipts(id).find((receipt) => receipt.id === rid);
      return !r || r.checkIndex !== index || !matches(review, r, c, id);
    })) return error("Current successful receipts required for every saved check", 409);
    const plan = await prepareIntegration({ sessionId: id, cwd: c.cwd, agentDir: c.agentDir,
      featureBranch: c.featureBranch, receiptIds: ids, getPolicy: c.policy });
    return NextResponse.json({ plan });
  } catch (cause) {
    if (cause instanceof ManagedGitAccessError) return error(cause.message, 409);
    // The engine's own fixed-prefix validation messages are sanitized; never
    // return raw Git stderr, check argv, private logs, or OS filesystem errors.
    if (cause instanceof Error && /^Git integration unavailable: [^\r\n]{1,160}$/.test(cause.message)) {
      return error(cause.message, 409);
    }
    return error("Integration unavailable; refresh review and inspect checkouts", 409);
  }
}
