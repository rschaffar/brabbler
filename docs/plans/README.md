# Plan index and closure dispositions

Plans describe bounded work, not standing implementation or Git authority. Current
behavior belongs in maintained guides and decisions in `docs/adr/`. This index
separates the remaining queue from historical evidence; it is not another execution
plan. The historical closure sweep used local main
`74c4fdaf659df2509a8ee3a452a82edaf3d5ff51` on 2026-10-27.
Rename support, notebook authoring and the Copilot schema plan were additionally
reconciled against local main `56efa61a5a3f6904f9db3e0932a1406b68ce8626` on
2026-11-18; see their completed records below. Other active entries retain their
recorded scope and were not re-audited by that update.

## Active work

| Plan | Remaining scope |
| --- | --- |
| [Account-aware catalogs with shared model settings](2026-10-31_account-catalog-refresh-plan.md) | Account-targeted catalog views/refresh, shared preferences/defaults and mutable model-state ownership. Application review and complete Nix acceptance passed; companion consuming input and local integrations remain pending. |
| [Brabbler 0.1.0 public release](2026-10-28_public-release-plan.md) | Implementation authorized and in progress: portable default-on authentication, fixed modular SDK policy and prebuilt archive are checkpointed; ELK is retained with separate source materials and notices. Linux acceptance and approved history/main cutover are complete; native macOS verification and remote repository/settings/CI/publication remain pending. |
| [Multi-provider accounts](2026-09-25_multi-provider-accounts-plan.md) | Account-scoped real OAuth/device completion, cancellation and provider refresh evidence, plus explicit isolation-review disposition; implementation is integrated. Synthetic browser authorization is not live-provider proof. |
| [Explorer fullscreen](2026-10-13_git-explorer-fullscreen-plan.md) | Dedicated already-paginated history/graph and unsupported/non-Git fullscreen browser cases, including expand/restore state retention. |
| [Eight-worker benchmark](2026-10-22_eight-worker-acceptance-plan.md) | Resource-admitted overlapping 8-core/8-browser measurement, or explicit retirement/deferral. The newer 12/4 experiment does not supply 8/8 proof. |
| [Core test optimization](2026-10-26_core-test-optimization-plan.md) | Delivered slices are integrated. Deferred native-wait/cache/remaining cost leads and original ownership-task performance measurements remain proposals with this owner, not automatic next work. |

Parked work outside main's plan queue, including broad MCP/OAuth/configuration
work and notebook authoring-guidance packaging, is not completed by this sweep.
Its existing worktrees/owners remain untouched.

## Git-backed operation reviews closure (2026-11-19)

The [Git-backed operation reviews plan](archived/2026-10-31_git-backed-operation-reviews-plan.md)
is archived. Implementation, converter, independent review, private-copy rehearsal
and complete acceptance were delivered at `61f1f60d7befd8cff60dfc0a597d0b863f50bd60`,
integrated through `9e7f5d093daa72b6b6fbd212275a9e7e596fafe0`. The former active
row incorrectly left converter/rehearsal/full acceptance open; the plan's later P4
closure is the evidence owner.

The maintainer reports new cards working and explicitly declines old-history
migration. This is not a live-conversion or independent deployment claim.
Repository-only converter retirement removes temporary tests/wiring, not current
Git-backed reviews. The [retirement ledger](../git-operation-review-retirement.md)
records historical reproduction, assertion dispositions and current closure owners.
[Historical migration/retention instructions](../git-operation-review-migration.md)
retain the tested revision and assign any future old-store/backup disposition to
the installation maintainer; all data remains retained absent separate approval.
No successor migration ticket, activation, publication or data deletion is implied.

## Completed-plan reconciliation (2026-11-18)

These three implementations are verified and integrated into local main. Their
plans are archived, not replacement tickets or active integration work. Each
record retains candidate-specific acceptance and names its maintained owners.
The merge IDs below are ancestors of the audited main; ancestry confirms local
integration, not historical approval provenance, deployment, publication or cleanup.
No new application acceptance was run for this documentation reconciliation.

| Archived plan | Integration merge | Maintained owner |
| --- | --- | --- |
| [Rename-aware committed Git reviews](archived/2026-11-03_git-rename-support-plan.md) | `0ebcbfcabe24` | [Worktrees](../worktrees.md), [feature contracts](../feature-internals.md) and [review metadata](../git-operation-review-metadata.md) |
| [Guided reading and native notebook authoring](archived/2026-11-05_notebook-authoring-plan.md) | `d219f1896fd1` | [Notebook guide](../review-notebooks.md), [retirement dispositions](../notebook-recording-retirement.md) and [ADR 0041](../adr/0041-guided-reading-and-notebook-authoring.md) |
| [Copilot-compatible Git worktree schema](archived/2026-10-31_copilot-argon-tool-schema-plan.md) | `298a89cc54b2` | [Git plugin contracts](../git-workflow-plugin.md#tools-and-correctness) |

Explicit non-goals and deferred proposals remain excluded; this closure neither
promotes them into active work nor completes adjacent operational migrations.

## Scoped skills and extensions

The [completed implementation record](archived/2026-11-16_skills-extensions-plan.md)
connects scoped hierarchy choices, independently admitted skill inspection and explicit
**Apply saved changes**, not automatic idle switching. Package management stays with
Pi/Nix; bundled permission controls are Built-in features. Complete acceptance passed
**543 core files / 4,911 tests**, **26 browser/terminal groups / 61 scenarios** and the
genuine Home Manager VM with **32 converter cases**, in **945.744 seconds** of summed
command time including realization. Source and browser/VM application identities match.
[Feature contracts](../feature-internals.md), [session contracts](../session-internals.md)
and ADRs [0044](../adr/0044-scoped-agent-resources.md),
[0045](../adr/0045-explicit-resource-application.md) and
[0046](../adr/0046-agent-resource-availability-only.md) own current behavior.
Exact-state local non-FF integration remains owned by native approval/outcome receipts;
archival is not integration, deployment, publication or cleanup authority.

## Integrated-worktree ignored-file disposal

The [completed implementation record](archived/2026-11-14_integrated-ignored-cleanup-plan.md)
adds explicit saved authority to permanently delete all safely supported ignored
contents only when removing a verified integrated feature worktree. Exact-path
approval remains the default; unignored untracked files and tracked changes block
the opt-in removal. Independent review, focused counterexamples and complete Nix
acceptance passed: **534 core files / 4,666 tests**, **26 browser/terminal groups**,
and genuine deployment in **433 seconds**, including realization, at four/four
widths while another Nix test workload was active. [ADR 0043](../adr/0043-integrated-worktree-ignored-files.md)
and the [Git plugin guide](../git-workflow-plugin.md#bounded-cleanup) own the decision
and current behavior. Mandatory exact-state local non-FF integration and cleanup
are handed to the receiving native Git lifecycle; this record does not prove those
effects or authorize live settings, deployment or publication.

## Settings-first MCP defaults

The [completed implementation record](archived/2026-11-13_mcp-settings-plan.md)
replaces whole-selection defaults in chats with per-server Global/Project settings,
separate Code-mode defaults and a compact current-chat picker. Legacy exclusions
are preserved. Independent review and complete Nix acceptance passed: **534 core
files / 4,640 tests**, all **26 browser/terminal groups** and the genuine deployment
VM in **448 seconds**, including realization. [Native session tools](../native-session-tools.md)
owns current behavior. Local integration remains separately approved; no host
deployment or remote publication is implied.

## Global native-tool defaults

**Superseded UX and default layering:** the Settings-first follow-up above replaces
the session-dialog controls and whole-selection inheritance. The original
[completed implementation record](archived/2026-11-13_global-native-default-plan.md)
adds global selections for future ordinary chats with explicit session → project →
global → off precedence. Independent review and complete Nix acceptance passed:
534 core files / 4,628 tests, all 26 browser/terminal groups and the genuine deployment
VM in 459 seconds, including realization. [Native session tools](../native-session-tools.md)
owns current behavior. Local integration remains separately gated; no host deployment
or remote publication is implied.

## Notebook-wide reference refresh

The [implementation record](archived/2026-11-09_notebook-refresh-plan.md) closes the
initial tooling slice: revision-bound target inventory, mapping-scoped bulk
refresh, explicit source destinations and bounded diagnostics. Independent reviews
closed; complete Nix acceptance passed **534 files / 4,637 tests**, all **26
browser/terminal groups / 61 input chains** and genuine deployment. The
[notebook guide](../review-notebooks.md) owns current contracts. This archive is an
implementation handoff, not proof of Git integration: mandatory local integration
and cleanup remain owned by the native lifecycle and its exact-state receipts.
Derived assets and automatic correspondence remain outside this slice.

## Contextual model settings and shared thinking defaults

The [verified UI follow-up](archived/2026-11-02_model-settings-ux-plan.md) places catalog account selection in provider detail and shared native per-model thinking defaults on the model rows. It preserves account-bound catalogs, shared preferences, project/pin precedence, explicit conversation intent and durable/read-only recovery. After the independent Copilot tool-schema integration, complete Nix acceptance passed **523 files / 4,429 tests**, all **26 browser/terminal groups / 58 inputs** and the genuine Home Manager VM in **517 seconds**, including realization, at resource-admitted four/four overlap. [Model/account contracts](../model-internals.md) owns current behavior. Exact local integration, deployment, publication and resource cleanup retain separate gates; archival is not their receipt. The adjacent account-catalog plan retains its distinct consuming-input follow-up.

## Git Workflow override matrix

The [verified matrix implementation](archived/2026-10-28_git-settings-override-matrix-plan.md)
shows all three scopes together, preserves explicit values/inheritance/pins and
policy authority, and keeps native scope-bound editors. The separately approved
move/startup repair and exact guided-review maintenance-observer correction are
also verified. Complete Nix acceptance on `738d5dec` passed **527 files / 4,361
tests**, all **26 browser/terminal groups / 60 inputs**, and the genuine deployment
VM in **498.632s**, with admitted four/four overlap and separately warmed inputs.
[Git settings](../git-workflow-plugin.md), [session contracts](../session-internals.md),
[review notebooks](../review-notebooks.md) and [test-writing recipes](../test-writing.md)
own current behavior and proof limits. Exact local integration and cleanup remain
with the receiving session's global Git lifecycle; archival is not deployment,
publication or a Git execution receipt.

## Robot mascot and README capture

The [verified mascot implementation](archived/2026-10-28_robot-branding-plan.md)
applies the exact approved robot to app/demo branding, PWA icons and favicons,
with reproducible artwork and the user's approved syntax-highlighted README
screenshot. Complete acceptance passed **526 files / 4,319 tests**, all **26
browser/terminal groups / 60 scenarios**, and the genuine Home Manager VM in
**454.805s**, at resource-admitted 12/4 overlap with warmed prerequisites.
[Branding](../branding.md) owns regeneration; the archive retains prior failures
and the explicitly superseded monochrome capture. Local integration and cleanup
remain separately gated; this record is not a deployment/publication claim.

## Local CLI web authentication

The [verified CLI-auth implementation](archived/2026-10-27_cli-web-auth-plan.md)
adds private local `brabbler auth setup`, salted scrypt credentials, independent
session signing and fail-closed required authentication. Full Nix acceptance
passed **526 files / 4,316 tests**, **26 browser/terminal groups / 60 scenarios**
and the genuine deployment VM in **506.373s**, with resource-admitted four/four
overlap. [Feature contracts](../feature-internals.md) and README own behavior;
the archive retains exact evidence and the corrected inventory failure. The user
selected local-main integration; its exact Git gate and foreign consumer/live
cutover remain separate and are not execution claims in this source plan.

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
