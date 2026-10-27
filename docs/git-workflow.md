# Git in Brabbler

Brabbler provides standalone worktree browsing/management, read-only Git status
and working-file diffs, and independent Git Explorer with committed patches.
See [Worktrees](worktrees.md) for controls and limitations.

The former managed Git Workflow has been removed: its settings, proposals,
task lifecycle, mutation tools, action journal and recovery unlock no longer gate
ordinary chats or coding/shell tools. Obsolete Workflow settings are not consulted.

The later, optional [Git Workflow plugin](git-workflow-plugin.md) is a separate
implementation with scoped settings, exact-operation approval cards and durable
execution receipts. Its presence does not restore the old managed task registry,
quarantine/recovery machinery or unfinished roadmap. Git usage still follows
applicable user/repository instructions; neither removal nor a historical receipt
grants permission to integrate, publish or delete resources.

Existing private Workflow data and transcript history are left on disk and are
not migrated or cleaned up. Source removal was integrated at `10f6a0f4193353bc8521f7cab98be40dcda227e3`; later complete acceptance covers the surviving application. This does not establish which source is installed: rebuild/activation remains separately authorized.

[ADR 0014](adr/0014-remove-managed-git-workflow.md) owns the removal and retirement
of old obligations. The [archived removal record](plans/archived/2026-09-29_policy-driven-git-tools-plan.md)
preserves original failures and verification checkpoints; it is not an active queue.
Current operations belong to the plugin guide and current verification to
[Testing](testing.md).
