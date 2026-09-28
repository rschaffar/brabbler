import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { gitExecEnv } from "@/lib/git-exec";
import { beginGitAction, failGitAction, gitActionSink, snapshotGitActionCandidate } from "@/lib/git-action-controller";
import { getRpcSession } from "@/lib/rpc-manager";
import { GitReviewError, getGitReviewDiff, reviewGitBranches, type GitReviewSelection } from "@/lib/git-review";
import { readSessionGitWorkflow } from "@/lib/git-workflow-policy";
import { samePath, toNativePath } from "@/lib/paths";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
const run = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_POST_BYTES = 256 * 1024;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}

// No caller-provided Git arguments. Do not expose Git's stderr (it may include
// paths or configuration secrets), or allow inherited GIT_DIR to redirect us.
async function checkout(cwd: string): Promise<string> {
  const env = { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0" };
  const git = async (...args: string[]) => (await run("git", ["-C", cwd, "--no-pager", ...args], {
    env, timeout: 15_000, maxBuffer: 4096, encoding: "utf8",
  })).stdout.trim();
  if (!samePath(cwd, realpathSync(cwd))) throw new Error("Checkout must be a physical repository root");
  const root = toNativePath(await git("rev-parse", "--show-toplevel"));
  if (!samePath(root, cwd)) throw new Error("Checkout must be a repository root");
  const ref = await git("symbolic-ref", "--quiet", "HEAD");
  if (!ref.startsWith("refs/heads/") || ref.length <= "refs/heads/".length) throw new Error("A local feature branch is required");
  const branch = ref.slice("refs/heads/".length);
  if (!OID.test(await git("rev-parse", "--verify", "HEAD^{commit}"))) throw new Error("Feature branch has no commit");
  return branch;
}

async function sessionReview(sessionId: string) {
  const file = await resolveSessionPath(sessionId);
  if (!file) return { response: error("Session not found", 404) };
  let header: ReturnType<typeof readSessionHeader>;
  try { header = readSessionHeader(file); }
  catch { return { response: error("Session not persisted", 409) }; }
  if (!header || header.id !== sessionId || typeof header.cwd !== "string" || !header.cwd) {
    return { response: error("Session identity mismatch", 409) };
  }
  const cwd = header.cwd;
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots)) return { response: error("Access denied", 403) };
  try {
    if (!statSync(cwd).isDirectory()) return { response: error("Not a directory", 400) };
  } catch { return { response: error("Directory not found", 404) }; }
  if (!isExistingFilePathAllowed(cwd, roots)) return { response: error("Access denied", 403) };
  const live = getRpcSession(sessionId);
  const manager = live?.isAlive() && live.sessionFile === file ? live.inner.sessionManager : SessionManager.open(file, undefined);
  if (manager.getHeader()?.id !== sessionId || !samePath(manager.getHeader()?.cwd ?? "", cwd)) {
    return { response: error("Session identity mismatch", 409) };
  }
  const policy = readSessionGitWorkflow(manager.getEntries() as SessionEntry[]);
  if (!policy?.integration) return { response: error("Session has no integration target", 409) };
  const feature = await checkout(cwd);
  if (policy.mode === "current" && policy.branch && policy.branch !== feature) {
    return { response: error("Checkout branch changed", 409) };
  }
  const review = await reviewGitBranches(cwd, feature, policy.integration.targetBranch);
  if (await checkout(cwd) !== feature) return { response: error("Checkout branch changed", 409) };
  return { cwd, feature, review, file };
}

function failure(cause: unknown) {
  if (cause instanceof GitReviewError) {
    if (cause.code === "INVALID_SELECTION") return error("Invalid review selection", 400);
    if (cause.code === "DIFF_TOO_LARGE") return error("Review patch exceeds size limit", 413);
    if (cause.code === "STALE_REFS") return error("Review is stale; refresh", 409);
    return error("Review unavailable; refresh", 409);
  }
  return error("Review unavailable", 409);
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get("sessionId");
    if ([...params.keys()].length !== 1 || typeof id !== "string" || !id.trim() || id !== id.trim()) {
      return error("Valid sessionId required", 400);
    }
    const result = await sessionReview(id);
    if (result.response) return result.response;
    return NextResponse.json({ review: result.review });
  } catch (cause) { return failure(cause); }
}

export async function POST(req: Request) {
  try {
    // Bound the input too: a commit selection never needs an unbounded body.
    if (Number(req.headers.get("content-length")) > MAX_POST_BYTES) return error("Request too large", 413);
    const reader = req.body?.getReader();
    if (!reader) return error("Invalid JSON", 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_POST_BYTES) { await reader.cancel(); return error("Request too large", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return error("Invalid JSON", 400); }
    if (!record(body) || !fields(body, ["sessionId", "expectedFeatureOid", "expectedTargetOid", "selection"]) ||
      typeof body.sessionId !== "string" || !body.sessionId.trim() || body.sessionId !== body.sessionId.trim() ||
      typeof body.expectedFeatureOid !== "string" || !OID.test(body.expectedFeatureOid) ||
      typeof body.expectedTargetOid !== "string" || !OID.test(body.expectedTargetOid) || !record(body.selection)) {
      return error("Invalid review request", 400);
    }
    const selection = body.selection;
    if (!(selection.kind === "merge" && fields(selection, ["kind"])) &&
        !(selection.kind === "commits" && fields(selection, ["kind", "commitOids"]) &&
          Array.isArray(selection.commitOids) && selection.commitOids.length > 0 && selection.commitOids.length <= 2000 &&
          selection.commitOids.every((oid) => typeof oid === "string" && OID.test(oid)))) {
      return error("Invalid review selection", 400);
    }
    const result = await sessionReview(body.sessionId);
    if (result.response) return result.response;
    if (result.review!.featureOid !== body.expectedFeatureOid || result.review!.targetOid !== body.expectedTargetOid) {
      return error("Review is stale; refresh", 409);
    }
    const diff = await getGitReviewDiff(result.cwd!, result.review!, selection as GitReviewSelection);
    if (await checkout(result.cwd!) !== result.feature) return error("Checkout branch changed", 409);
    // GET remains side-effect-free. An explicit Show patch POST captures this
    // comparison as history, not as approval of any commit/integration.
    const id = body.sessionId, cwd = result.cwd!, file = result.file!;
    const action = await beginGitAction({ sessionId: id, append(record) {
      // Re-open at the synchronous append boundary, never retain an idle stale
      // manager across asynchronous Git/artifact work or recreate a moved file.
      const current = readSessionHeader(file);
      if (current?.id !== id || !samePath(current.cwd, cwd)) throw new Error("Session moved before comparison capture");
      const live = getRpcSession(id);
      if (live?.isAlive() && live.sessionFile !== file) throw new Error("Session file changed");
      const manager = live?.isAlive() ? live.inner.sessionManager : SessionManager.open(file, undefined);
      return gitActionSink(manager, (type, data) => manager.appendCustomEntry(type, data)).append(record);
    } }, "human", snapshotGitActionCandidate({ kind: "review", featureCwd: cwd,
      review: result.review!, selection: selection as GitReviewSelection, diff }));
    try {
      await action.update("awaiting-decision");
      await action.update("succeeded", { outcome: { status: "comparison-captured" } });
      return NextResponse.json({ diff, actionId: action.record.id });
    } catch (cause) { await failGitAction(action, false, req.signal, cause); throw cause; }
    finally { action.release(); }
  } catch (cause) { return failure(cause); }
}
