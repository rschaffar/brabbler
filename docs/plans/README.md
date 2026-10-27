# Plan index and closure dispositions

Plans describe bounded work, not standing implementation or Git authority. Current
behavior belongs in maintained guides and decisions in `docs/adr/`. This index
separates the remaining queue from historical evidence; it is not another execution
plan. Status reconciled against local main `74c4fdaf659df2509a8ee3a452a82edaf3d5ff51`
on 2026-10-27.

## Active work

| Plan | Remaining scope |
| --- | --- |
| [Multi-provider accounts](2026-09-25_multi-provider-accounts-plan.md) | Account-scoped real OAuth/device completion, cancellation and provider refresh evidence, plus explicit isolation-review disposition; implementation is integrated. Synthetic browser authorization is not live-provider proof. |
| [Claude CLI sessions](2026-09-26_claude-cli-sessions-plan.md) | Backend/policy/protocol work is not delivered on main. Retained feature branches are not integration evidence. |
| [Explorer fullscreen](2026-10-13_git-explorer-fullscreen-plan.md) | Dedicated already-paginated history/graph and unsupported/non-Git fullscreen browser cases, including expand/restore state retention. |
| [Eight-worker benchmark](2026-10-22_eight-worker-acceptance-plan.md) | Resource-admitted overlapping 8-core/8-browser measurement, or explicit retirement/deferral. The newer 12/4 experiment does not supply 8/8 proof. |
| [Core test optimization](2026-10-26_core-test-optimization-plan.md) | Delivered slices are integrated. Deferred native-wait/cache/remaining cost leads and original ownership-task performance measurements remain proposals with this owner, not automatic next work. |

Parked work outside main's plan queue, including broad MCP/OAuth/configuration
work and notebook authoring-guidance packaging, is not completed by this sweep.
Its existing worktrees/owners remain untouched.

## Brabbler rename

The [verified source rename](archived/2026-10-27_brabbler-rename-plan.md) implements
the clean Brabbler identity break, with Pi-native storage/interfaces and the π
icon retained. Full application acceptance passed 525 files / 4,309 tests, all
26 browser/terminal groups / 59 scenarios and the genuine deployment VM in
467.988 seconds. [The cutover guide](../brabbler-rename.md) owns durable naming
and separate migration requirements. No compatibility reader or committed
migration tool was added. User selected local-main integration; exact Git
execution and cleanup remain separately gated, and archival is not their receipt.
Live migration, activation, URL changes and the foreign NixOS consumer are not
claimed implemented by this source change.

## Production profiling and payload closure

The user explicitly requested closure after all three catalogue slices were verified.
The [executed plan](archived/2026-10-26_pi-web-production-profiling-plan.md) retains
profiling, relation reuse, refresh coalescing, lossless compact transport and failed/
successful acceptance evidence. Final composed candidate `0f75818` on `8c25dd7`
passed **523 files / 4,291 tests**, **26 browser/terminal groups / 59 receipts** and
genuine deployment VM checks in **423.975s**. This is not a production benchmark.
[Production performance](../production-performance.md) owns durable findings and
the deferred production/SPA measurements; [Session contracts](../session-internals.md)
owns mechanisms. No measurement is claimed complete by the handoff. Exact local
integration/cleanup remains with the receiving session's gated Git receipts;
archival is not approval, execution evidence or deployment.

## Guided review workflow acceptance

The [complete implementation record](archived/2026-10-23_guided-review-notebooks-plan.md)
now closes both notebook increments, not another reader-only milestone. The composed
candidate `bda3cf5` on `9b8f024` passed full Nix acceptance: **522 files / 4,285 tests**,
**26 browser/terminal groups / 59 receipts**, genuine deployment VM, **585s**. The
[notebook guide](../review-notebooks.md) and [ADR 0036](../adr/0036-guided-review-recording.md)
own delivered contracts. Exact local integration/cleanup disposition remains owned
by the receiving session's gated Git receipts; archival is not integration approval.
The historical audit and lineage table below retain their original scope.

## Closure evidence

This is a documentation reconciliation, not a new complete acceptance run.
All lineage IDs below are ancestors of the audited main. Ancestry proves
integration, not historical approval provenance, deployment or resource cleanup.
Original failed runs, uncertain attribution and old worktree observations remain
historical. An unchanged passing retry is not relabelled a fix.

Later recorded complete Nix acceptance at
`532a17656be3f38c06dc19c774a206b6d4eadac8` covers the surviving application:

- Command: `nix run .#test -- all --workers 4 --jobs 12`, exit 0, **393s** including
  in-run realization; **516 core files / 4,243 tests / 14 suites**, all **26
  browser/terminal groups / 59 receipts**, genuine Home Manager deployment VM.
- Immutable source digest:
  `a347597642b33b93da61d26d00182e948c75a0dcb71bc6e9ee0853988edce5ac`.
- Reports: `/tmp/pi-web-test-core.ePKx16/run.json`,
  `/tmp/pi-web-test-browser.cLZIMq/run.json`, `/tmp/pwv-a1eQTs/run.json`;
  command log `/tmp/guided-reader-composed-all.ZSqi9O.log`.
- Exact preparation/execution intervals, admission and limits remain in the
  [reader acceptance record](archived/2026-10-23_guided-review-notebooks-plan.md#complete-reader-acceptance).

This later evidence resolves obsolete browser-library/full-suite blockers only
for relevant surviving flows. It does not certify an absent scenario, live OAuth,
a historical exact tip or removed managed-Workflow functionality. Historical SDK,
Nix and testing milestones also retain their own recorded acceptance; superseded
recipes are not current contributor instructions.

## Closed milestones

The 23 plans below are closed. Their closure notices supersede old pending-merge
and environmental-blocker text; original checkboxes remain historical evidence,
not a live queue or a claim that every original-tip check was executed. Maintained
owners hold delivered contracts, accepted limits and durable findings.

| Archived plan | Integrated lineage | Maintained owner |
| --- | --- | --- |
| [Account usage limits](archived/2026-09-25_account-usage-limits-plan.md) | `56cbdde` | [Model/account contracts](../model-internals.md) and README |
| [Browser ask_user](archived/2026-09-25_browser-ask-user-plan.md) | `43abbe9` | [Questions](../questions.md) |
| [Server Activity review](archived/2026-09-25_server-activity-review-plan.md) | `8eb2d81` | [Feature contracts](../feature-internals.md) and [Activity testing](../activity-testing.md) |
| [Session search scope](archived/2026-09-26_session-search-scope-plan.md) | `1515ae8` | [Session contracts](../session-internals.md) and README |
| [Explorer split diff](archived/2026-09-27_git-explorer-split-diff-plan.md) | `623197a` | [Worktrees](../worktrees.md); later Pierre/context behavior supersedes the original renderer restriction |
| [Worktree Explorer](archived/2026-09-27_worktree-git-explorer-plan.md) | `538f54f` | [Worktrees](../worktrees.md) |
| [Explorer sidecar/branches](archived/2026-09-28_git-explorer-sidecar-branches-plan.md) | `f9c5f46` | [Worktrees](../worktrees.md) |
| [SDK 0.99.1](archived/2026-09-29_pi-sdk-0.99.1-upgrade-plan.md) | `af3d596` | [Dependencies](../dependencies.md); historical milestone, not current pins |
| [Managed Workflow removal](archived/2026-09-29_policy-driven-git-tools-plan.md) | `10f6a0f` | [ADR 0014](../adr/0014-remove-managed-git-workflow.md) and [Git overview](../git-workflow.md) |
| [Nix development/service](archived/2026-10-01_nix-native-development-and-service-plan.md) | `cb1ce1e` | README and [Testing](../testing.md); later isolated production/VM checks resolve the original build deferral |
| [SDK 1.0.0](archived/2026-10-02_pi-sdk-1.0.0-upgrade-plan.md) | `300be97` | [Dependencies](../dependencies.md); historical milestone, not current pins |
| [Move picker](archived/2026-10-05_session-move-picker-plan.md) | `6a0678d` | [Session contracts](../session-internals.md) |
| [Persistent interaction cards](archived/2026-10-06_persistent-interaction-cards-plan.md) | `23fb676` | [Questions](../questions.md) and [Feature contracts](../feature-internals.md) |
| [Question sets](archived/2026-10-08_question-sets-plan.md) | `fe77710` | [Questions](../questions.md) |
| [Session Git policy](archived/2026-10-08_session-git-policy-plan.md) | `ead699c` | [Git plugin](../git-workflow-plugin.md); separate Nix handoff below |
| [Development verification](archived/2026-10-09_development-verification-plan.md) | `277db23` | [Testing](../testing.md) and [browser lifecycle](../../e2e/README.md); old dev-server recipes superseded |
| [Project trust scopes](archived/2026-10-09_git-project-trust-scopes-plan.md) | `c09460c` | [Worktrees](../worktrees.md) and [Feature contracts](../feature-internals.md) |
| [Nix-native acceptance](archived/2026-10-15_nix-native-acceptance-plan.md) | `34ac894` | [Testing](../testing.md), ADRs 0023–0025; sequential browser-heavy VM placement superseded |
| [Parallel acceptance](archived/2026-10-15_parallel-nix-acceptance-plan.md) | `3b7ab9d` | [Testing](../testing.md), ADRs 0024–0025; measured 658s result retained, shared-VM lanes superseded |
| [Session archive](archived/2026-10-18_session-archive-plan.md) | `680870c` | [Session contracts](../session-internals.md) and README |
| [Session launch](archived/2026-10-18_session-launch-plan.md) | `3f1bce8` | [Session launch](../session-launch.md), including current Nix verification commands |
| [Native session tools](archived/2026-10-21_native-session-tools-plan.md) | `ff69773` | [Native tools](../native-session-tools.md); broader configuration/OAuth work excluded |
| [Complete test ownership](archived/2026-10-23_complete-test-ownership-plan.md) | `3f3944e` | [Ownership ledger](../test-ownership.md), [Writing tests](../test-writing.md), [Testing](../testing.md) and ADR 0034 |

The ownership plan's [handoff](archived/2026-10-23_complete-test-ownership-handoff.md)
and [reflection](archived/2026-10-23_complete-test-ownership-reflection.md) are archived
historical companions, not two additional active implementation plans.

### Separate Nix handoff

Pi Web's session-policy scope is complete. The separately prepared
`~/nix/my_nix_os` commit `67c1de6d6b6adf9fb65ef73a089becd7ce5c2c1b` and its
integration/activation disposition remain owned by that repository's isolated
session-policy change. This sweep neither verifies nor performs foreign-repository
integration, activation or cleanup. Existing external work is not silently waived.

## Retired managed-Workflow plans

[ADR 0014](../adr/0014-remove-managed-git-workflow.md) is the explicit disposition
owner for every unmet obligation in these six plans. They are **retired, not fully
implemented**. No remaining old automation, admission/recovery, opt-out, migration,
cleanup or Nix rollout obligation transfers into the optional plugin backlog.

- [Session Git workflow](archived/2026-09-26_session-git-workflow-plan.md)
- [Agent Git review](archived/2026-09-27_agent-git-review-plan.md)
- [Git panel UX](archived/2026-09-27_git-panel-ux-plan.md)
- [Integrated Git workflow](archived/2026-09-28_integrated-git-workflow-plan.md)
- [Reviewed stale-check recovery](archived/2026-10-01_reviewed-stale-check-recovery-plan.md)
- [Session Workflow opt-out](archived/2026-10-01_session-git-workflow-opt-out-plan.md)

Historical private data, feature branches/worktrees, backups and diagnostic roots
are not deleted by plan retirement. Only this documentation task's own integrated
resources are candidates for separately gated cleanup.
