import { prepareGitCommit, confirmGitCommit } from "./git-commit";
import { getGitCommitTreeOid, getGitTreeDiff } from "./git-review";
import { beginGitAction, failGitAction, finishGitAction, snapshotGitActionCandidate, GitActionApplyError, GitActionRecordingError, type GitActionSink } from "./git-action-controller";
import type { GitActionCandidate } from "./types";

/** Shared Ask path. Patch bytes live in private artifacts/UI, never tool results. */
export async function requestWorkflowCommit(options: {
  cwd: string; paths: string[]; message: string; signal?: AbortSignal;
  sink: GitActionSink;
  ask: (candidate: GitActionCandidate, signal?: AbortSignal) => Promise<boolean>;
  beforeApply: () => Promise<void>;
}) {
  await options.beforeApply();
  const preview = await prepareGitCommit(options.cwd, options.paths);
  const parentTree = await getGitCommitTreeOid(options.cwd, preview.head);
  const diff = await getGitTreeDiff(options.cwd, parentTree, preview.tree);
  const candidate = { kind: "commit" as const, preview, message: options.message, diff };
  const action = await beginGitAction(options.sink, "agent", snapshotGitActionCandidate(candidate));
  let applying = false;
  try {
    await action.update("awaiting-decision");
    if (!await options.ask({ ...candidate, actionId: action.record.id }, options.signal) || options.signal?.aborted) {
      await action.update(options.signal?.aborted ? "cancelled" : "declined", { decision: options.signal?.aborted ? "cancelled" : "declined" });
      return { content: [{ type: "text" as const, text: "Commit declined or cancelled; no commit was made." }], details: { approved: false, actionId: action.record.id } };
    }
    // Approved is not committed. The engine still validates the complete snapshot.
    await action.update("executing", { decision: "approved" });
    await options.beforeApply();
    options.signal?.throwIfAborted();
    const result = await confirmGitCommit(preview, options.message, async (intended) => {
      await action.update("executing", { intended });
      await options.beforeApply();
      options.signal?.throwIfAborted();
      applying = true;
    });
    await finishGitAction(action, result, result.status === "partial-success");
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { ...result, actionId: action.record.id } };
  } catch (cause) {
    await failGitAction(action, applying, options.signal, cause);
    if (!applying && options.signal?.aborted) return {
      content: [{ type: "text" as const, text: "Commit cancelled; no commit was made." }],
      details: { approved: false, actionId: action.record.id },
    };
    if (applying && !(cause instanceof GitActionRecordingError)) throw new GitActionApplyError(action.record.id, action.record.intended);
    throw cause;
  } finally { action.release(); }
}
