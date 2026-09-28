import { prepareGitCommit, confirmGitCommit } from "./git-commit";
import { getGitCommitTreeOid, getGitTreeDiff } from "./git-review";
import type { GitActionCandidate } from "./types";

/** Shared Ask path. Patch bytes go only to the browser, not the tool result. */
export async function requestWorkflowCommit(options: {
  cwd: string; paths: string[]; message: string; signal?: AbortSignal;
  ask: (candidate: GitActionCandidate, signal?: AbortSignal) => Promise<boolean>;
  beforeApply: () => Promise<void>;
}) {
  await options.beforeApply();
  const preview = await prepareGitCommit(options.cwd, options.paths);
  const parentTree = await getGitCommitTreeOid(options.cwd, preview.head);
  const diff = await getGitTreeDiff(options.cwd, parentTree, preview.tree);
  if (!await options.ask({ kind: "commit", preview, message: options.message, diff }, options.signal) || options.signal?.aborted) {
    return { content: [{ type: "text" as const, text: "Commit declined or cancelled; no commit was made." }], details: { approved: false } };
  }
  await options.beforeApply();
  if (options.signal?.aborted) return { content: [{ type: "text" as const, text: "Commit cancelled; no commit was made." }], details: { approved: false } };
  const result = await confirmGitCommit(preview, options.message);
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
}
