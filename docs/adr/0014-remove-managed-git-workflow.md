# ADR 0014: Remove managed Git Workflow

- Status: Accepted; removal integrated, surviving application subsequently accepted
- Supersedes: managed Workflow product/runtime obligations in ADRs 0007–0013

## Decision

Remove the managed Git Workflow end to end, rather than complete the live-settings
migration or four-tool redesign. Usable ordinary chats and fast, reliable
surviving tests take priority over retaining the feature's architecture.

Delete feature-only tools, settings/proposals, APIs, cards, guidance, runtime
wiring, authorization/evidence/preparation/recovery engines and tests after
removing their callers. Do not retain dormant paths or compatibility wrappers
for hypothetical reuse. Ordinary sessions, forks, subagents and shell tools must
not be gated by missing, disabled, malformed or obsolete Workflow settings.

Preserve independent Git Explorer, read-only status/diffs, standalone worktrees,
files, ordinary chat/streaming/session/terminal functionality and genuinely shared
utilities. SDK project trust continues to protect project-controlled resource
loading, independently of the removed Workflow.

## Consequences and boundaries

Existing private data and raw history remain untouched: no migration, pruning or
cleanup is part of removal. This is not permission to change installed services,
global configuration, credentials, repository lifecycle rules or remote state.
Removal was integrated at `10f6a0f4193353bc8521f7cab98be40dcda227e3`, an ancestor
of audited main `74c4fdaf659df2509a8ee3a452a82edaf3d5ff51`. This ancestry establishes
integration, not historical approval provenance or installed-service activation.
Rebuild/activation, publication and resource cleanup remain separately authorized.
Current repository Git and isolated-build rules apply to subsequent work.

The [archived removal plan](../plans/archived/2026-09-29_policy-driven-git-tools-plan.md)
preserves source checkpoints and the failed final historical recheck. It does not
claim a successful full rerun at that old tip. Later complete Nix acceptance at
`532a17656be3f38c06dc19c774a206b6d4eadac8` covers the surviving application:
516 core files / 4,243 tests, all 26 browser/terminal groups / 59 receipts and the
genuine Home Manager deployment VM. Exact source, command and artifacts are in
the [closure evidence index](../plans/README.md#closure-evidence).

This decision is the explicit retirement owner for remaining managed-Workflow
obligations in the old session-workflow, agent-review, panel-UX, integrated-workflow,
stale-check-recovery and per-chat opt-out plans. Their unimplemented or unverified
tasks are retired, not completed or transferred into the optional plugin backlog.
No obsolete checks, task migration, quarantine recovery, standing-grant orchestration
or Nix instruction rollout is still required by those plans.

The later [optional Git Workflow plugin](../git-workflow-plugin.md) has its own
contracts and does not reverse this removal. Current verification belongs to
[Testing](../testing.md); removed-feature E2E and containment obligations do not apply.
