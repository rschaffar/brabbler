# Git in Pi Web

Pi Web provides standalone worktree browsing/management, read-only Git status
and working-file diffs, and independent Git Explorer with committed patches.
See [Worktrees](worktrees.md) for controls and limitations.

The managed Git Workflow feature has been removed: no Workflow settings,
proposals, mutation tools, action/approval cards, task lifecycle, receipt protocol
or recovery unlock remains. Ordinary chats and coding/shell tools do not consult
obsolete Workflow settings. Git usage still follows applicable user/repository
instructions; removal does not grant permission to integrate, publish or delete
resources.

Existing private Workflow data and transcript history are left on disk and are
not migrated or cleaned up. Source removal requires approved local integration
and a separately authorized rebuild/activation before installed behavior changes.

[ADR 0014](adr/0014-remove-managed-git-workflow.md) records the removal decision;
the [current checklist](plans/2026-09-29_policy-driven-git-tools-plan.md) owns
source verification and the integration handoff.
