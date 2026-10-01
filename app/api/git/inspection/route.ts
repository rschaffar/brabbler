import { NextResponse } from "next/server";
import { GitProjectResourceError, gitProjectResourceSummary, revalidateGitProjectResources, selectCanonicalGitResources, withGitProjectReview } from "@/lib/git-project-resources";
import { getGitReviewDiff, GitReviewError, reviewGitBranches, type GitReviewSelection } from "@/lib/git-review";
import { validLocalBranchName } from "@/lib/git-workflow-policy";

export const dynamic = "force-dynamic";
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LIMIT = 256 * 1024;
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every((key) => Object.hasOwn(v, key)) && Object.keys(v).every((key) => required.includes(key) || optional.includes(key));

function failure(cause: unknown) {
  if (cause instanceof GitProjectResourceError) return NextResponse.json({ error: cause.message, code: cause.code }, { status: cause.code === "access-denied" ? 403 : cause.code === "invalid-selection" ? 400 : 409 });
  if (cause instanceof GitReviewError) return error(cause.code === "DIFF_TOO_LARGE" ? "Comparison too large" : "Review unavailable or stale", cause.code === "DIFF_TOO_LARGE" ? 413 : 409);
  return error("Repository inspection unavailable", 409);
}

/** Browser read-only status. This is not a task, grant, or shell/file cwd change. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if ([...url.searchParams.keys()].some((key) => !["repositoryPath", "checkoutPath", "workspaceBranch"].includes(key)) ||
    [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1) ||
    !url.searchParams.has("repositoryPath") || !url.searchParams.has("checkoutPath")) return error("Canonical repository and checkout required", 400);
  try {
    const selection = await selectCanonicalGitResources({ repositoryPath: url.searchParams.get("repositoryPath")!, checkoutPath: url.searchParams.get("checkoutPath")!, workspaceBranch: url.searchParams.get("workspaceBranch") ?? undefined });
    await revalidateGitProjectResources(selection);
    return NextResponse.json({ selection: gitProjectResourceSummary(selection), capabilities: { status: true, review: process.platform === "linux", mutations: false } });
  } catch (cause) { return failure(cause); }
}

/** Stateless comparison: no journal entry, mutation permission, or replay authority. */
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length")) > LIMIT) return error("Request too large", 413);
    const reader = req.body?.getReader();
    if (!reader) return error("Invalid JSON", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LIMIT) { await reader.cancel(); return error("Request too large", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!record(body) || !keys(body, ["repositoryPath", "checkoutPath", "targetBranch", "selection"], ["workspaceBranch"]) ||
      typeof body.targetBranch !== "string" || !validLocalBranchName(body.targetBranch) || !record(body.selection) ||
      !(body.selection.kind === "merge" && keys(body.selection, ["kind"]) ||
        body.selection.kind === "commits" && keys(body.selection, ["kind", "commitOids"]) &&
        Array.isArray(body.selection.commitOids) && body.selection.commitOids.length > 0 && body.selection.commitOids.length <= 2000 &&
        body.selection.commitOids.every((oid) => typeof oid === "string" && OID.test(oid)))) return error("Invalid comparison request", 400);
    const selected = await selectCanonicalGitResources({ repositoryPath: body.repositoryPath as string, checkoutPath: body.checkoutPath as string, workspaceBranch: body.workspaceBranch as string | undefined });
    const result = await withGitProjectReview(selected, async (repository) => {
      const review = await reviewGitBranches(repository, selected.branch, body.targetBranch as string);
      return { review, diff: await getGitReviewDiff(repository, review, body.selection as GitReviewSelection) };
    });
    return NextResponse.json({ selection: gitProjectResourceSummary(selected), ...result, approval: false });
  } catch (cause) {
    if (cause instanceof SyntaxError) return error("Invalid JSON", 400);
    return failure(cause);
  }
}
