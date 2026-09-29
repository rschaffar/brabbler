# Policy-driven Git tools: revised implementation roadmap

## Goal

Make routine Git work cheaper for the agent and less repetitive for the user: reusable project policies, explicit operation scope across repositories/worktrees, optional human confirmations, deliberate staging, and agent-driven preparation against a moving local integration target. A conversation need not move or belong to any worktree.

**Status: design revision; implementation not authorized by this request.** The user asked to rethink and adapt the concept before continuing implementation. [ADR 0011](../adr/0011-policy-driven-git-tools.md) records the clarified direction. Current runtime permissions and repository/global approval rules remain unchanged; this plan grants no execution, merge, cleanup, publication or deployment authority.

## Plan Relationship and supersession

This is the sole active successor to [the integrated Git workflow plan](2026-09-28_integrated-git-workflow-plan.md). That plan is retired as a future-work queue, not deleted or marked fully completed. Its implementation slices, measured evidence and old checkboxes remain historical. [ADR 0010](../adr/0010-integrated-git-workflow.md) retains the corresponding earlier decision record; ADR 0011 governs conflicting future direction.

Every outstanding obligation is either reassigned or explicitly retired:

| Previous workstream | New owner/disposition |
| --- | --- |
| A: capability matrix, concurrency and recovery audit | Phases 1–5 below, scoped to each operation rather than mandatory task ownership |
| B: settings, permissions, migration and one editor | Phase 1; scoped authorization replaces a required per-task adoption ceremony |
| C: common commit path and durable evidence | Phase 2; reuse delivered journals/cards, add permission-controlled and staged candidates |
| D: source selection, workspace/checks, rebase/integration | Phases 1, 3 and 4; **retire** autonomous start/finish, mandatory workflow IDs, managed session handoff and exclusive task/workspace ownership |
| E: cleanup and artifact lifecycle | Phase 5 for deletion safety; deferred backlog below owns artifact retention/export |
| F: compatible instructions, verification and deployment | Per-slice release gate below; global/Nix policy changes and activation need separate authority |
| Comprehensive adopted prose-rule normalization | **Retired as an execution prerequisite**; agent follows relevant instructions and tools enforce supported concrete restrictions |
| Source bindings and prototype task UI | Preserve evidence/records; phase 1 removes the prerequisite from the primary UX, with no implied data deletion |

No separate Nix behavioral design is introduced. The Nix package-consumption change already integrated is not instruction alignment and did not remove the conservative always-ask rules.

## Current evidence and reuse

The earlier six-commit feature was integrated into local `rst-main` as `1d70af2044051fad527c534d6385afe83988c061`; this documentation work reuses the retained linked `docs/integrated-git-workflow` checkout advanced to that local tip. The code is unchanged by this revision.

| Source | Reuse / limitation confirmed during this revision |
| --- | --- |
| `lib/git-workflow-settings.ts`, settings store and Workflow home | Field-level inheritance, canonical project defaults, origins and drafts exist. Current commits default to Ask; Off denies commits. Chat×Project policy and preauthorization need implementation. |
| `lib/git-workspace-selector.ts`, agent workflow extension | Same-repository `workspaceBranch` exists; explicit other-repository operation scope does not. Captured task/source evidence does not retarget tools. |
| `lib/git-commit.ts` | Exact candidate/index/ref protections and partial-success reporting exist. Only whole files with a clean initial index are supported; partial staging is not implemented. |
| `lib/git-verification.ts`, `lib/git-workflow-permissions.ts` | Receipts and live guards are reusable; verification currently depends on integration/target worktrees and needs decoupling. |
| `lib/git-integration.ts`, `lib/git-review.ts` | Stale state fails closed, but native execution is non-FF only and has no rebase or moving-target preparation loop. |
| `lib/git-action-controller.ts`, `lib/git-action-journal.ts` | Private immutable evidence and small non-context chat anchors are reusable across explicitly scoped operations. |

The user explicitly clarified that "commit checks off" means **human commit-confirmation prompts off**, not automated verification off. Preserve that distinction in UI/schema/tests. The desired repeated-rebase loop returns to the agent after every actual rewrite, including conflict-free rebases; semantic assessment and unforeseen issues remain ordinary agent work under project rules.

## Architecture and non-goals

- Policy resolver: Global → canonical Project → Chat×Project exceptions, with separate action permissions, delivery restrictions, recipe definitions and provenance.
- Resource resolver: explicit canonical repository/checkout handles revalidated per action; no hidden active project, automatic shell/file-tool retargeting or chat movement.
- Operations: inspect, workspace, commit, prepare/rebase, verify, integrate and cleanup, with exact candidates and concise typed outcomes. The agent chooses the next call.
- Evidence/admission: existing journals, operation-scoped critical sections, stale detection and truthful recovery; not exclusive conversation ownership or an external-process sandbox.
- UI: one project-selectable Workflow editor plus durable multi-project action history. Remove mandatory task/source adoption from the normal path; optional move/fork remains a utility.

Non-goals: autonomous finish/merge queues; automatic semantic conflict resolution; mandatory normalized AGENTS profiles; session relocation as a prerequisite; cross-repository atomic transactions; hidden commit-all/stash/reset; remote fetch/push/PR creation; a new Nix deployment; universal hooks/signing/filters/Windows support. Additional methods such as squash are not required by this revision and must not substitute for FF/non-FF.

## Plan

### 0. Complete this documentation-only revision

- [x] Read ADRs 0007–0010, the current guide/roadmap and relevant implementation boundaries; record the user's clarified control model in ADR 0011 rather than silently rewriting accepted history.
- [x] Mark ADR 0010 and the previous plan as superseded/retired where applicable, add guide/README entry links, and verify there is one active roadmap and a clear current-versus-target distinction.
- [x] Review the new concept against direct-main, multi-project, partial-staging, PR-only and moving-target scenarios; resolve material questions before implementation, and validate Markdown links/fences plus `git diff --check`.
- [x] Present the revised documents and remaining assumptions to the user; source implementation remains a separate next step.

Documentation evidence, 2026-09-29: two independent read-only reviews checked the clarified product model and compatibility/safety boundaries. Their two material findings—result-dependent agent reentry and crash-surviving check-process quarantine—were incorporated and re-reviewed as resolved. A Python standard-library check validated fenced blocks and 45 relative file-link targets across the six changed Markdown files; whitespace checks passed. Runtime tests, TypeScript, ESLint and browser tests were not rerun for this documentation-only change. The presentation states that implementation, live permission changes, Nix instructions and activation remain out of scope; other-action confirmation defaults stay conservative pending explicit configuration.

### 1. Explicit resources, reusable policy and simpler settings

- [ ] Extend the resource-selection layer and tool/route schema for explicit canonical repository plus registered checkout or validated handle; tests alternate two worktrees in A and a checkout in B from one unchanged chat, including duplicate branch names, replaced roots and denied access.
- [ ] Evolve settings, store, resolver and permission tests for named project main/base/target, direct/worktree strategy, local/PR/leave delivery, FF/non-FF method and independent action confirmation; prove no project-specific branch, recipe or authority leaks through Global or Chat×Project overrides.
- [ ] Add explicit user-saved action authorization and live revocation at shared route/tool boundaries; test that model parameters, copied sessions, existing source bindings and history do not mint it, and that forbidden delivery/caller modes override permissive inherited settings.
- [ ] Carry unresolved operation/check state into shared admission before enabling new mutation paths; test that a fresh invocation or restart cannot bypass an affected checkout's recovery/quarantine state.
- [ ] Preserve legacy restrictions on migration; test that newly enabled commit configuration offers commits enabled/confirmation off, while existing Ask/Manual/Off/opt-out states do not silently acquire broader authority.
- [ ] Simplify `GitWorkflowHome` around project selection, settings and recent actions; browser-test no mandatory task/request/source adoption, no session movement, scope-bound drafts, source labels, pending-action identity and explicit permission-save summaries.

### 2. Permission-controlled commits and deliberate staging

- [ ] Route agent and manual commit surfaces through the same scoped operation controller; test no human prompt under applicable saved permission, exact approval in Ask mode, caller/project denial, revocation after preview, actual author/result IDs and existing partial-success recovery.
- [ ] Retain whole-file mode and implement an explicit staged-candidate mode in the commit engine; disposable-repository tests prove partial hunks and unselected index/worktree changes survive, ambiguous/widened selection is refused, and changed captured index/candidate fails before ref update.
- [ ] Keep tools concise and history complete; test metadata-only normal results, on-demand authoritative diffs, no patch-sized model context, and correct project/workspace attribution without another confirmation merely to view a comparison.

### 3. Independent workspaces, verification and preparation

- [ ] Make worktree creation/attachment an independently authorized operation without chat transitions or one-start-per-chat coupling; test repeated creation/use from one chat, selected local base or existing branch, preserved source files and distinct Ask/Allow/disabled behavior. Merely selecting an existing checkout starts nothing.
- [ ] Decouple verification from merge targets; add explicit recipe cwd/environment and required-stage selection as supported capabilities. Tests cover direct-main and PR/handoff checks, conservative project-required checks, empty defined recipes without fake receipts, and command/recipe changes requiring appropriate authority.
- [ ] Persist verification run/process/resource identity and reconcile descendants surviving cancellation or restart without trusting recycled PIDs; crash-injection tests prove affected checkouts refuse new commits, rebases, integration and deletion until safe reconciliation, and expired receipts cannot clear that quarantine.
- [ ] Implement one guarded native preparation/rebase attempt with structured before/after/conflict/stale outcomes; test private-history eligibility, dirty/operation markers, changed target/source, preservation/recovery and no rewriting published/uncertain history merely because it is in a worktree.
- [ ] Prove **every actual rebase yields its result to the agent** before a dependent verification/integration invocation, including conflict-free and content-equivalent rewrites; require a result-issued revision dependency and reject prequeued/batched prepare → verify → integrate without it. Document that reentry proves control flow, not semantic correctness; keep code/conflict assessment with the agent, without a mandatory human acknowledgement.

### 4. Moving-target local integration

- [ ] Implement FF-only alongside explicit non-FF using the existing exact-state engine boundaries; method-specific tests verify result refs, parents/tree and no fallback, target-into-feature catch-up merge, or integration-to-self.
- [ ] Bind final integration and check evidence to the actual source/target/recipe/policy snapshot; test stale target outcomes after preparation, during checks and at final apply, with old approvals/receipts refused and no hidden rebase inside integrate.
- [ ] Test two and three concurrent features repeatedly preparing for one target: one can land, losers return concise `target_moved`, repeat under saved rebase permission, reenter the agent and reverify changed candidates; no redundant routine human prompts in Allow mode, fresh exact approval in Ask mode, and bounded contention handling.
- [ ] Prove PR/leave delivery prevents local integration even with a permissive Global policy. Handoff reports branch/evidence only and cannot fetch, push or create a PR. Busy/failed/partial outcomes never trigger an automatic retry.

### 5. Independently authorized cleanup

- [ ] Add cleanup preview/application over exact eligible resources without session ownership; tests cover provenance, successful disposition, primary/target protection, unmerged/shared/uncertain history, dirty/untracked/ignored data, symlinks, locks and late writers.
- [ ] Verify active-session/terminal/check-process and deletion-admission races before enabling unattended cleanup; unknown inventory or surviving children retain resources. A chat actually located there needs an explicit relocation choice, not a default move at worktree creation.
- [ ] Keep cleanup permission independent of integration and result history; test retained resources by default, configured Ask/Allow, revoked permission and partial deletion recovery without forced removal.

### Per-slice release gate: align instructions and verify

This gate applies as each supported slice ships, not only after cleanup is implemented. Do not postpone useful commit behavior behind the entire roadmap, or advertise prompt-free operation while applicable instructions still contradict it.

- [ ] Propose a separately authorized change to Pi Web guidance, applicable project rules and Nix-managed global Git skills/templates: supported saved decisions replace redundant questions, selected-repository instructions still govern, missing/denied capabilities cannot be bypassed through shell. Test supported/absent/legacy tools and stricter projects before advertising prompt-free behavior.
- [ ] For each implemented slice, run its focused and adversarial suites, common Pi Web checks and affected browser flows on the exact candidate; test terminal flows only when changed. Respect the no-production-build-during-development rule.
- [ ] Record actual release/activation and loaded-instruction evidence separately from source merge; do not activate Nix policy, update other projects or migrate live consent during this documentation task.

### Deferred backlog, not prerequisites for the next slice

These inherited obligations retain this plan as their owner rather than becoming competing roadmaps:

- [ ] Add explicit artifact retention/export and check-log viewing when separately prioritized; preserve current evidence and distinguish missing artifacts from current checkout data.
- [ ] Evaluate an optional versioned Git CLI adapter and additional history/signing/platform capabilities only when needed; require parity of scope, authorization and outcomes, never an escape route after a safety denial.
- [ ] Extend durable action projection to newly implemented workspace/preparation/cleanup operations as they ship; do not add a task-owned lifecycle merely to group cards.

## Acceptance and risks

Use ADR 0011's scenario table as the behavioral acceptance contract. Measure routine question count and agent plumbing calls for complete saved policies, not just whether a Git command succeeds. Verify confirmations can be enabled independently without disabling the action, and zero configured check recipes is never described as zero project verification obligations.

The principal risks are cross-project permission leakage, commit default migration, staged-data loss, rewriting unsafe history, stale integration and deletion races. Mitigate them in the relevant slice before enabling its Allow mode. Short resource reservations and ref/index rechecks reduce races but do not coordinate arbitrary external Git writers. Unknown and partial state stops that action; it is not automatically reset/retried.

Rollback disables new action entry points/permissions while retaining action artifacts and actual Git results. Never infer restored authority from old records or revive an interrupted operation. Retiring task/source UI does not delete private evidence. Policy/instruction deployment and remote operations remain separately authorized.

## Completion Checklist

### Documentation revision

- [x] ADR 0011 is the readable design entry point, with explicit retractions and current-vs-future boundaries.
- [x] The previous plan's unmet work has a current owner or explicit retirement; there is no second active implementation queue.
- [x] Clarified defaults, per-operation/project identity, staging, PR delivery and repeated rebase/agent-assessment semantics pass review and documentation checks.

### Implementation (not completed or authorized by this revision)

- [ ] One unchanged chat can use correctly scoped tools across repositories/worktrees without task adoption or session moves.
- [ ] Saved policy suppresses routine questions where permitted, with clear optional confirmations and separate verification obligations.
- [ ] Selected/staged commits, independent checks, worktree creation, repeated preparation and FF/non-FF integration pass exact-state, migration and adversarial tests.
- [ ] PR/handoff and direct-main projects behave without fake local-integration stages or inferred remote authority.
- [ ] Cleanup is exposed only after independent permission, exact-resource and admission/recovery tests pass.
- [ ] Tool guidance, UI claims and applicable deployed instructions agree; unsupported cases remain explicit rather than shell fallbacks.
