# Policy-driven Git tools: revised implementation roadmap

## Goal

Make routine Git work cheaper for the agent and less repetitive for the user: reusable project policies, explicit operation scope across repositories/worktrees, optional human confirmations, deliberate staging, and agent-driven preparation against a moving local integration target. A conversation need not move or belong to any worktree.

**Status: implementation started.** After the documentation revision, the user said “alright. start the implementation,” authorizing application work in the retained linked worktree. [ADR 0011](../adr/0011-policy-driven-git-tools.md) records the clarified direction. This is source-implementation authority, not consent to alter live permissions, repository/global rules, Nix instructions or deployment. Integration, cleanup and publication still require their existing separate approvals.

**Immediate priority after the first slice:** the user requested a mergeable version fixing two observed regressions before the broader roadmap: unnecessary Git calls during ordinary conversation, and the blocking request to edit/apply settings that cannot be changed while the same run is waiting. This authorizes the bounded source fixes and design/plan updates, not an SDK upgrade, edits to the referenced live chats, live policy changes, deployment or integration without its existing approval.

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

## Starting evidence and reuse

The earlier six-commit feature was integrated into local `rst-main` as `1d70af2044051fad527c534d6385afe83988c061`; the documentation revision reused the retained linked `docs/integrated-git-workflow` checkout advanced to that local tip and changed no runtime code. Implementation now continues there. The table records the starting assessment; bounded implementation evidence is tracked under phase 1.

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

### 0a. Priority mergeable repair: quiet guidance and usable worktree setup

Observed reproductions: a request to render LaTeX received a hidden per-run `Use git_workflow status` instruction and an unnecessary status call. Separately, a worktree-mode chat with `baseBranch: null` was asked to configure/apply `rst-main` while blocked in `ask_user`; the session settings route and UI require an idle run, so the suggested completion path was unavailable until Stop. Both stem from the earlier managed-task design, not missing implementation authority from the user.

- [x] Replace unconditional per-run synthetic Git-task messages with concise conditional instruction guidance; keep status optional and test non-Git requests, fresh settings/capability changes, and absence of full settings dumps.
- [x] Exclude only superseded app-owned Git reminders from future model context, preserving raw history, user messages, other extensions and real Git safety gates; test resumed-session behavior and exact-prompt/Chat-only compatibility.
- [x] Distinguish missing worktree input from denied permission. Support an explicit local base/tip creation proposal with its own approval when no base is saved, without editing/applying task settings during a blocking question. Preserve configured-base/mode restrictions, live revocation, physical source identity, clean-state checks, cancellation and truthful partial results. The one-off path is **create-only/stay**, not a new `continue` or `fork` permission.
- [x] Make the UI/status explain any remaining idle-only setup path, and browser-test the reported waiting-question scenario plus the supported approval path without silently moving the chat or saving defaults. The browser covers the pending-question/disabled-editor state; native approval/creation and cancellation are covered in disposable-repository tests, not by a model-driven browser run.
- [x] Add allowlisted native integration **pre-approval** phase diagnostics, UTF-8 check-input bounds, a four-check decline-only primary-caller/linked-feature/trust regression, and rejection of a managed check/target policy changed during approval. Neither diagnosis nor a previous review is execution consent.
- [ ] Identify the **installed** native integration failure’s precise cause using a fresh exact candidate; the previous generic error was shown before check approval, but the specific underlying exception is still unknown. If the native tool remains blocked, seek separate approval for a supported exact-state path—never reuse a historical plan or treat a diagnostic as authorization.
- [x] Add an opt-in real-model, disposable-environment behavioral regression: an ordinary LaTeX request produces no tool/Git calls, and a Git-relevant question invokes one inert, read-only `git_workflow status` probe. User authorized this bounded provider-backed run; no live chat, credential inspection, mutation tool or automatic CI charge. Separate operation-gate tests still own mutation safety. One model run does not prove universal compliance.
- [x] Run focused/adversarial tests, `npm test`, TypeScript, lint, affected browser flows and Markdown checks on the source candidate. The quoted SDK-upgrade request is a regression scenario, not an instruction to upgrade packages in this slice.
- [ ] Commit the bounded source candidate, then obtain fresh exact-state approval for an unsigned non-FF integration; no cleanup, deployment or publication follows implicitly.

Verification evidence for the bounded source candidate: **1,874 tests / 0 failures**, `node_modules/.bin/tsc --noEmit`, `npm run lint` and `git diff --check` passed. `nix develop --offline path:. -c env E2E_GIT_WORKFLOW_ONLY=1 npm run test:e2e` passed affected desktop/mobile Git flows, including a real pending `ask_user` with Session Save/Apply unavailable and the create-only explanation. SDK 0.87.1 `ExtensionRunner` and `convertToLlm` tests verify filtered resumed model context, prompt sections and unchanged raw entries. The separately authorized `PI_GUIDANCE_MODEL_EVAL=1 node e2e/git-guidance-model.mjs` also passed both real-provider prompts in a disposable in-memory chat: no tool call for the LaTeX request and exactly one inert Git status for the Git request. It is a smoke test for that configured provider/run, not a universal model guarantee. Disposable-repository tests cover explicit missing base, decline, mismatch, pause during approval, stale tip, create-only completion and a late admission callback; external writers can still race the final native worktree add. Read-only adversarial review found stale integration policy across approval and an asynchronous worktree preflight window; both were tightened. Follow-up review exposed the legacy-to-managed variant, now rejected and covered by a focused test. A concurrent external filesystem writer can still replace the worktree destination parent with a symlink between the final native check and Git's path resolution; this repository's native Git operations do not coordinate such writers. Do not claim a symlink-race-free creation boundary. Root cause of the **installed** generic integration failure and deployment remain unverified; production-session/model behavior beyond the isolated smoke test is not established.

These are early acceptance refinements of ADR 0011, not a new task-owned lifecycle or standing authorization. The broader phases remain owned below; do not wait for the full permissions/cleanup roadmap to ship this repair.

### 1. Explicit resources, reusable policy and simpler settings

**First bounded slice:** canonical resource identity, project-keyed chat overrides, independent project selection in Workflow, and explicitly targeted agent status/read-only review. Existing exact-approval mutation paths stay compatible. Cross-project mutations and confirmation-free modes remain blocked until selected-policy authorization and recovery admission are connected; a new repository argument must not reuse the caller project's captured policy or grants. This slice does not complete all of phase 1.

First-slice implementation is verified in the retained worktree. It adds `git-project-resources.ts`, `git-project-session.ts` and `git-project-settings.ts`, an independent Workflow configuration-project picker, separate Chat×Project draft keys, and status/review-only `repositoryPath`. Legacy action/source panels are optional disclosures. Review findings led to descriptor-pinned Linux comparison reads, use of the captured branch rather than rediscovery, and canonical restriction lookup for nested caller cwds. Broader settings/action authorization and every new mutation path remain unchecked below.

- [x] First slice: capture explicit physical repository/worktree identity for status/read-only review; regression tests cover matching branch names, duplicate registrations, denied/replaced roots, transient Git-directory/branch substitution, descriptor cleanup, and a pending A comparison while B is inspected.
- [x] First slice: isolate project-qualified preferences from unqualified legacy state; tests cover project alternation, resets, copied preferences without grants, malformed/newer records, restrictive legacy clamps in root/nested/linked callers, and canonical-resolution failure.
- [x] First slice: expose project selection and Chat×Project drafts without moving the chat or requiring task/source adoption; browser-test independent A/B saves/resets and preserved drafts alongside existing supervised actions.

Verification evidence: `npm test` passed **1,825 tests**; `node_modules/.bin/tsc --noEmit`, `npm run lint` and `git diff --check` passed. `nix develop --offline path:. -c env E2E_GIT_WORKFLOW_ONLY=1 npm run test:e2e` passed the affected Git browser flows, including the new cross-project settings case, legacy source evidence, exact commit/non-FF merge, history/reload, and desktop/mobile containment. Two read-only adversarial reviews rechecked the material fixes without remaining runtime findings. The full-suite run also corrected an older inheritance test that passed a SessionManager where an entries array was required. No terminal behavior changed, so terminal tests were not applicable. No production build, live consent migration, Nix/global instruction change, deployment or remote action occurred. Integration approval remains separate.

**Next usability slice — agent-proposed settings:** a chat can propose specific Global, Project or Session override changes for one-click human review without giving the agent a settings-write tool. This slice does not grant automatic Git actions or capture a task; it is independent of the remaining policy-authority work below.

- [x] Add a bounded, server-owned proposal locator for an ordinary persisted chat, with strict field validation, explicit inherit resets, canonical project selection, saved-scope revision and identity checks; focused tests confirm proposal creation does not write.
- [x] Show saved/proposed overrides and effective values in an in-chat card with independent human Apply/Dismiss, idle-only Session write, the existing locked settings-save path, stale rejection and one-shot disposition. Focused API tests cover Global, Project, Chat×Project, unqualified Session, forged IDs/bodies, revocation via write epoch and changed identity; the focused browser fixture tests rendering/click/reload ordering using a mocked endpoint.
- [x] Update the current guide and verify this source slice with `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, the focused browser suite and `git diff --check`. Proposals are process-local and lost on restart; applying them is not task Apply or Git execution.

Verification: `npm test` passed **1,880 tests / 0 failures** in this linked checkout; `node_modules/.bin/tsc --noEmit`, `npm run lint` (no warnings), and `git diff --check` passed. `nix develop --offline path:. -c env E2E_GIT_WORKFLOW_ONLY=1 npm run test:e2e` passed the desktop Git browser flow including the in-chat card and a delayed stale GET after Apply. The browser endpoint is mocked to avoid a model/provider run; the real server proposal/apply/write gates are exercised in disposable-session/repository API tests. A read-only adversarial review identified minimap ref alignment, stale GET ordering, and a late subagent marker; all three were tightened and retested. Process-local proposal loss, external writers, and a same-user agent's ability to reach the browser API remain explicit bounds. This source change does not modify live settings, install a release, or merge itself.

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
- [ ] Record actual release/activation and loaded-instruction evidence separately from source merge; do not activate Nix policy, update other projects or migrate live consent as part of source implementation.

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

### Implementation (authorized after the documentation revision; in progress)

- [ ] One unchanged chat can use correctly scoped tools across repositories/worktrees without task adoption or session moves.
- [ ] Saved policy suppresses routine questions where permitted, with clear optional confirmations and separate verification obligations.
- [ ] Selected/staged commits, independent checks, worktree creation, repeated preparation and FF/non-FF integration pass exact-state, migration and adversarial tests.
- [ ] PR/handoff and direct-main projects behave without fake local-integration stages or inferred remote authority.
- [ ] Cleanup is exposed only after independent permission, exact-resource and admission/recovery tests pass.
- [ ] Tool guidance, UI claims and applicable deployed instructions agree; unsupported cases remain explicit rather than shell fallbacks.
