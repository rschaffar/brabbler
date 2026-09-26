import { execFile } from "node:child_process";
import { promisify } from "node:util";
// @ts-expect-error Native Node test imports require the .ts suffix; Next resolves it too.
import { gitExecEnv } from "./git-exec.ts";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const METADATA_MAX_BYTES = 8 * 1024 * 1024;
/** Maximum patch returned to a caller; an oversized patch is an error, never a partial patch. */
export const GIT_REVIEW_DIFF_MAX_BYTES = 1024 * 1024;
const MAX_COMMITS = 2000;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export type GitReviewErrorCode =
  | "INVALID_REF" | "NOT_ANCESTOR" | "MERGE_CONFLICT" | "MERGE_UNAVAILABLE"
  | "STALE_REFS" | "INVALID_SELECTION" | "DIFF_TOO_LARGE" | "GIT_FAILURE";

export class GitReviewError extends Error {
  readonly code: GitReviewErrorCode;

  constructor(code: GitReviewErrorCode, message: string) {
    super(message);
    this.name = "GitReviewError";
    this.code = code;
  }
}

export interface GitReviewCommit {
  oid: string;
  /** First parent (the left side of this commit's individual diff). */
  parentOid: string;
  treeOid: string;
}

/** All identities are captured from local refs, not from a worktree or index. */
export interface GitReview {
  targetBranch: string;
  targetOid: string;
  targetTreeOid: string;
  featureBranch: string;
  featureOid: string;
  featureTreeOid: string;
  /** The exact candidate tree computed by merge-tree, not an inferred working tree. */
  mergeTreeOid: string;
  /** Oldest to newest along the feature's first-parent chain after target. */
  commits: GitReviewCommit[];
}

export type GitReviewSelection =
  | { kind: "commits"; commitOids: string[] }
  | { kind: "merge" };

export interface GitReviewDiff {
  fromTreeOid: string;
  toTreeOid: string;
  /** Git's unified text patch; binary changes appear as `Binary files ... differ` summaries. */
  patch: string;
  hasBinaryChanges: boolean;
}

// No shell, remote, pager, user diff program, or textconv. Do not read files in
// the checkout: even an ignored secret or log file must not enter this review.
async function git(cwd: string, args: string[], maxBuffer = METADATA_MAX_BYTES): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, "--no-pager", ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    encoding: "utf8",
    env: {
      ...gitExecEnv(),
      GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_PAGER: "cat",
    },
  });
  return stdout;
}

function exitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}

function requireOid(value: string): string {
  if (!OID.test(value)) throw new GitReviewError("GIT_FAILURE", "Git returned an invalid object ID");
  return value;
}

async function branchOid(cwd: string, branch: string): Promise<string> {
  if (!branch || branch.startsWith("-")) throw new GitReviewError("INVALID_REF", "Invalid local branch");
  try {
    await git(cwd, ["check-ref-format", "--branch", branch]);
    return requireOid((await git(cwd, ["show-ref", "--verify", "--hash", `refs/heads/${branch}`])).trim());
  } catch (error) {
    if (error instanceof GitReviewError) throw error;
    throw new GitReviewError("INVALID_REF", `Local branch not found or invalid: ${branch}`);
  }
}

export async function getGitCommitTreeOid(cwd: string, commitOid: string): Promise<string> {
  return requireOid((await git(cwd, ["rev-parse", "--verify", `${requireOid(commitOid)}^{tree}`])).trim());
}

/** Capture a review only for a local feature that descends along its first-parent chain from target. */
export async function reviewGitBranches(cwd: string, featureBranch: string, targetBranch: string): Promise<GitReview> {
  const targetOid = await branchOid(cwd, targetBranch);
  const featureOid = await branchOid(cwd, featureBranch);
  if (targetBranch === featureBranch) throw new GitReviewError("INVALID_REF", "Feature and target must be different branches");

  try {
    await git(cwd, ["merge-base", "--is-ancestor", targetOid, featureOid]);
  } catch (error) {
    if (exitCode(error) === 1) throw new GitReviewError("NOT_ANCESTOR", "Target must be an ancestor of feature");
    throw new GitReviewError("GIT_FAILURE", "Could not check branch ancestry");
  }

  // %H, %P and %T are hex OIDs. No commit messages or filesystem contents.
  let commits: GitReviewCommit[];
  try {
    const output = await git(cwd, ["log", "--first-parent", "--reverse", "--format=%H%x00%P%x00%T", `${targetOid}..${featureOid}`]);
    const lines = output.trim() ? output.trim().split("\n") : [];
    if (lines.length > MAX_COMMITS) throw new GitReviewError("GIT_FAILURE", "Too many commits to review");
    commits = lines.map((line) => {
      const [oid, parents, tree, extra] = line.split("\0");
      if (extra !== undefined || !parents) throw new GitReviewError("GIT_FAILURE", "Invalid commit history");
      return { oid: requireOid(oid), parentOid: requireOid(parents.split(" ")[0]), treeOid: requireOid(tree) };
    });
  } catch (error) {
    if (error instanceof GitReviewError) throw error;
    throw new GitReviewError("GIT_FAILURE", "Could not read commit history");
  }
  // A target merged only as a second parent cannot define a contiguous
  // first-parent review from that target; refuse rather than show a false range.
  if ((commits[0]?.parentOid ?? featureOid) !== targetOid ||
      commits.some((commit, index) => index > 0 && commit.parentOid !== commits[index - 1].oid)) {
    throw new GitReviewError("NOT_ANCESTOR", "Target is not on the feature's first-parent chain");
  }

  let mergeTreeOid: string;
  try {
    const output = await git(cwd, ["merge-tree", "--write-tree", targetOid, featureOid]);
    mergeTreeOid = requireOid(output.trim().split("\n")[0]);
  } catch (error) {
    if (error instanceof GitReviewError) throw error;
    if (exitCode(error) === 1) throw new GitReviewError("MERGE_CONFLICT", "Proposed merge has conflicts");
    throw new GitReviewError("MERGE_UNAVAILABLE", "Could not compute a clean merge tree (Git merge-tree --write-tree required)");
  }

  const targetTreeOid = await getGitCommitTreeOid(cwd, targetOid);
  const featureTreeOid = await getGitCommitTreeOid(cwd, featureOid);
  // A ref may move while the subprocesses run. Never return a snapshot whose
  // identities were already obsolete when it was completed.
  if (await branchOid(cwd, targetBranch) !== targetOid || await branchOid(cwd, featureBranch) !== featureOid) {
    throw new GitReviewError("STALE_REFS", "Branch tips changed during review");
  }
  return {
    targetBranch, targetOid, targetTreeOid,
    featureBranch, featureOid, featureTreeOid,
    mergeTreeOid, commits,
  };
}

/** Recheck both exact refs before *and after* each diff. Never silently update a review. */
export async function getGitReviewDiff(cwd: string, review: GitReview, selection: GitReviewSelection): Promise<GitReviewDiff> {
  const assertFresh = async () => {
    let target: string;
    let feature: string;
    try {
      target = await branchOid(cwd, review.targetBranch);
      feature = await branchOid(cwd, review.featureBranch);
    } catch {
      throw new GitReviewError("STALE_REFS", "Review branches are missing or changed");
    }
    if (target !== review.targetOid || feature !== review.featureOid) {
      throw new GitReviewError("STALE_REFS", "Branch tips changed; refresh the review");
    }
  };
  await assertFresh();

  let fromTreeOid: string;
  let toTreeOid: string;
  if (selection.kind === "merge") {
    fromTreeOid = review.targetTreeOid;
    toTreeOid = review.mergeTreeOid;
  } else if (selection.kind === "commits" && Array.isArray(selection.commitOids) && selection.commitOids.length > 0) {
    const start = review.commits.findIndex((commit) => commit.oid === selection.commitOids[0]);
    if (start < 0 || selection.commitOids.some((oid, index) => review.commits[start + index]?.oid !== oid)) {
      throw new GitReviewError("INVALID_SELECTION", "Select an ordered, contiguous set of commits");
    }
    const last = review.commits[start + selection.commitOids.length - 1];
    fromTreeOid = start === 0 ? review.targetTreeOid : review.commits[start - 1].treeOid;
    toTreeOid = last.treeOid;
  } else {
    throw new GitReviewError("INVALID_SELECTION", "Select commits or the whole merge");
  }
  const diff = await getGitTreeDiff(cwd, fromTreeOid, toTreeOid);
  await assertFresh();
  return diff;
}

/** Bounded patch between exact trees; callers own any ref/checkout freshness checks. */
export async function getGitTreeDiff(cwd: string, fromTreeOid: string, toTreeOid: string): Promise<GitReviewDiff> {
  requireOid(fromTreeOid);
  requireOid(toTreeOid);

  let patch: string;
  try {
    patch = await git(cwd, [
      "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3",
      fromTreeOid, toTreeOid, "--",
    ], GIT_REVIEW_DIFF_MAX_BYTES);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new GitReviewError("DIFF_TOO_LARGE", "Diff exceeds the review size limit");
    }
    throw new GitReviewError("GIT_FAILURE", "Could not compute tree diff");
  }
  return { fromTreeOid, toTreeOid, patch, hasBinaryChanges: /^Binary files .+ differ$/m.test(patch) };
}
