import type { PluginCard } from "../../lib/plugins/types";
import type { CleanupOperation, CleanupSnapshot } from "./cleanup";
import { requiresDiscardLossAcknowledgment, type BrowserDiscardOperation } from "./discard";
import type { GitSettings } from "./manifest";

function artifactSection(cleanup: CleanupSnapshot) {
  return { title: "Generated files and directories to remove", fields: cleanup.artifacts.map((item) => ({ label: item.path,
    value: `${cleanup.unapprovedArtifacts.includes(item.path) ? "Needs one-time approval" : "Permitted by settings"} · ${item.entries} entries · ${item.bytes} bytes · SHA256 ${item.digest}`, code: true })) };
}
/** Presentation consumes a fresh capture; it does not grant or retain authority. */
export function browserDiscardCard(op: BrowserDiscardOperation, policy: GitSettings, cleanup: CleanupSnapshot): PluginCard {
  const subject = op.subject.kind === "branch" ? `${op.subject.branch} at ${op.subject.tip}` : `Detached HEAD at ${op.subject.head}`;
  const evidence = cleanup.lossEvidence!;
  const needsAcknowledgment = requiresDiscardLossAcknowledgment(op, evidence);
  return {
    title: "Remove selected Git resources", subtitle: "Manual browser confirmation required",
    ...(needsAcknowledgment ? { requiredAcknowledgment: "I understand that deleting this local branch can discard work not proven integrated, and I accept this loss." } : {}),
    fields: [{ label: "Repository checkout", value: cleanup.cwd, code: true },
      { label: "Exact subject", value: subject, code: true },
      { label: "Worktree", value: `${op.removeWorktree ? "Remove" : "Keep"}: ${cleanup.path ?? "none"}` },
      { label: "Local branch", value: op.deleteBranch ? "Delete this exact local ref" : "Keep (no branch deletion)" },
      { label: "Integration evidence", value: `${evidence.state}${evidence.reason ? `: ${evidence.reason}` : ""}` },
      { label: "Captured comparison (not policy authority)", value: op.comparisonTarget ? `${op.comparisonTarget.branch} at ${op.comparisonTarget.tip}` : "None", code: true },
      { label: "Protected designated target", value: policy.targetBranch ?? "None", code: true }],
    sections: [artifactSection(cleanup),
      ...(cleanup.unapprovedArtifacts.length ? [{ title: "One-time artifact permission", text: "Approving includes only the exact listed artifacts. Ignored status does not mean disposable; confirmation does not change your reusable allowlist.", notice: true }] : []),
      ...(needsAcknowledgment ? [{ title: "Branch loss warning", text: "This branch tip is not proven integrated into the captured comparison target. Deleting its local ref may discard unique work. No backup, retry, rollback, or remote operation is performed.", notice: true }] : []),
      ...(op.subject.kind === "detached" ? [{ title: "Detached commit warning", text: "Removing this detached worktree may remove the convenient reference to its captured HEAD commit. No branch is deleted. Reflogs and unreachable objects do not guarantee permanent commit retention; retain a reference manually if needed.", notice: true }] : []),
      { title: "Boundaries", text: "Only listed resources. Idle chat history stays, but continuing a chat may require moving it after its working folder disappears. Main, selected/invocation, designated/comparison target, locked/prunable and active resources remain protected. Dirty source or unignored untracked files block removal. Exact HEAD/ref, registration, physical identity and contents are rechecked before each effect. Completed-feature Keep preferences do not govern this deliberate manual operation. External Git/filesystem writers are not locked out. Dispatched effects settle; partial outcomes are reported, never rolled back. Branch config, remote refs and backups remain untouched.", notice: true }],
    scope: "Approves only these frozen branch/worktree/artifact resources together. It is not future disposal authority.",
    actions: [{ id: "reject", label: "Keep resources" }, { id: "approve", label: "Remove listed resources", primary: true }],
  };
}
export function cleanupCard(op: CleanupOperation, cleanup: CleanupSnapshot): PluginCard {
  return { title: "Clean up integrated Git feature", subtitle: "Approval required",
    fields: [{ label: "Repository checkout", value: cleanup.cwd, code: true },
      { label: "Integrated feature", value: `${op.featureBranch} at ${op.featureTip}`, code: true },
      { label: "Verified integration", value: `${op.integrationCommit} remains reachable from ${cleanup.target}`, code: true },
      { label: "Worktree", value: `${op.removeWorktree ? "Remove" : "Keep"}: ${cleanup.path ?? "none"}` },
      { label: "Local branch", value: op.deleteBranch ? "Delete exact integrated ref" : "Keep" }],
    sections: [artifactSection(cleanup),
      ...(cleanup.unapprovedArtifacts.length ? [{ title: "One-time artifact permission", text: "The listed unpermitted artifacts require your approval for this operation, even when cleanup is set to Allow. Ignored status does not mean disposable. Approving does not change your reusable allowlist.", notice: true }] : []),
      { title: "Boundaries", text: "Only listed resources. Idle chat history stays, but continuing a chat may require moving it after its working folder disappears. Running/starting sessions and active terminals block cleanup. Content/identity rechecked before each effect. Unknown files, source changes, locked or active worktrees block cleanup. Target advancement is allowed only while integration remains reachable. External filesystem/Git writers are not locked out; partial effects are reported, never rolled back. Local branch config is retained; remote branches and backups are untouched.", notice: true }],
    scope: "Approves all listed cleanup resources together, not an arbitrary ignored-file deletion.",
    actions: [{ id: "reject", label: "Keep resources" }, { id: "approve", label: "Clean up listed resources", primary: true }] };
}
