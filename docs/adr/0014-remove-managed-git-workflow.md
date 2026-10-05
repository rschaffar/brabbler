# ADR 0014: Remove managed Git Workflow

- Status: Accepted by explicit user steering; source acceptance pending
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
Local integration still requires exact-state approval and an unsigned non-FF
merge into `rst-main`; rebuild/activation, publication and resource cleanup need
separate authorization.

The existing [plan](../plans/2026-09-29_policy-driven-git-tools-plan.md) is the sole
short removal checklist. Earlier acceptance is historical, not removal evidence.
Verification covers surviving unit/type/lint and relevant ordinary browser flows;
removed Workflow E2E and containment obligations no longer apply. No production
build runs during development.
