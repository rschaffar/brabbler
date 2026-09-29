# Integrated Git workflow: historical design and implementation evidence

## Status — retired as a future-work queue

On 2026-09-29 the user clarified that Git tooling should apply reusable project policies to explicit operations across multiple worktrees and repositories, without binding or moving conversations. [ADR 0011](../adr/0011-policy-driven-git-tools.md) supersedes the conflicting direction in ADR 0010. The [policy-driven Git tools plan](2026-09-29_policy-driven-git-tools-plan.md) is the sole active successor and maps every outstanding workstream below to a new owner or explicit retirement.

This plan is **not fully completed** and is not archived as completed work. Original checkboxes, authorizations, source checkpoints and verification below are historical evidence, not an instruction to implement the superseded start/finish, task-ownership, handoff or mandatory source-adoption model. Delivered settings, history and Git safety mechanisms remain reusable. The six-commit feature, including Nix packaging, was subsequently integrated into local `rst-main` as `1d70af2044051fad527c534d6385afe83988c061`; that integration did not complete the original roadmap. Nix package consumption/activation is separate from the unimplemented instruction-alignment work.

## Original goal (historical)

Make Pi Web Git a coherent, optionally automated task workflow: layered defaults, one consolidated setup when needed, common consent across tools/UI, durable side-by-side action cards outside model context, and safe start-to-finish execution across different project definitions.

**Status:** staged application implementation in progress. The user's “alright. give it a shot” after the single-panel UX review authorizes Pi Web source changes in the existing linked worktree. It does not grant live execution consent or authorize Nix changes/activation, integration, publication, or cleanup. Global/Project/Session configuration stays in **one Workflow home**.

[ADR 0010](../adr/0010-integrated-git-workflow.md) records the accepted target and the narrower first implementation slice. A plan is not an authorization record for runtime actions. Current repository/global approval rules remain unchanged.

## Original plan relationship (superseded)

- At the time of this plan, it was the single follow-up owner for unified workflow settings, tool orchestration, persistent cards, standing authorization, and agent cleanup. That ownership now transfers to the successor linked above. The remaining workflow obligations in [the agent Git review plan](2026-09-27_agent-git-review-plan.md) transfer here; its checkboxes remain historical evidence, not a competing implementation queue.
- [The original session workflow plan](2026-09-26_session-git-workflow-plan.md) supplies reusable policy/commit/review/verification/integration mechanics. Its old snapshots and explicit approval paths must remain compatible during migration.
- [Git panel UX](2026-09-27_git-panel-ux-plan.md) and the Git Explorer plans document existing presentation. This proposal replaces the three mutation/settings sidecars, not the independent Explorer's read-only identity/bounds. It reuses the split-diff work without making browsing a mutation authority.
- The future Nix instruction patch is a separately authorized workstream in `~/nix/my_nix_os`, coordinated here. Do not create a second independent behavioral design there; link its bounded implementation/activation work back to this concept.
- No unrelated plan, provider/account storage, browser `ask_user` contract, release process, or repository-wide alignment task is owned here.

## Evidence and design decisions

Research was read-only in the primary Pi Web checkout, its local session history, installed Pi SDK docs/examples, and the relevant tracked Nix instruction sources. The documentation worktree starts at Pi Web `rst-main` commit `f9c5f468bd81efccfa5959ee431bd9282eaf0cbf`.

Important evidence:

| Source | Observation |
| --- | --- |
| `lib/git-workflow-policy.ts`, `lib/agent-git-preferences.ts` | Independent persisted configurations feed different tools. |
| `lib/git-workflow-store.ts`, `app/api/git/workflow/route.ts` | Project/session support, but no unified global layer or true Git feature switch. |
| `lib/git-commit-extension.ts`, `lib/agent-git-workflow-extension.ts` | Saved-consent commit and always-ask commit are distinct paths. |
| `lib/git-workspace-start-extension.ts` | Requires saved worktree policy; worktree intent alone is insufficient; transition is one-shot per chat. |
| `components/GitWorkflowSettings.tsx`, `hooks/useAgentSession.ts` | Pending new-chat state can outlive a closed panel's local representation; initialization and configuration are coupled. Source-derived risk, not browser-reproduced here. |
| `components/GitActionDialog.tsx`, `lib/rpc-manager.ts` | Live request/response lifecycle, not durable action/result history. |
| `lib/git-commit.ts`, `lib/git-integration.ts`, `lib/git-verification.ts` | Exact-state primitives and partial-state handling are reusable; mutation journal and broader capabilities need work. |
| Pi SDK `docs/session-format.md` | Plain `custom` entries are excluded from model context; `custom_message` entries are not. |
| Nix `home/presets/pi/AGENTS.md`, `home/presets/skills/git-worktrees/SKILL.md` | Unconditional worktree question and explicit CLI-centered interactive lifecycle. Installed skill matched tracked source via `cmp`. |
| Nix `home/presets/ai-agents.nix` | Shared installation across harnesses; runtime Pi settings are reseeded at activation. Keep mutable workflow state separate. |

No adoption-rate claim is made from the session sample. The old plan's cleanup-admission warning is a discovery lead: current move routes already have some gating, while startup admission still needs verification. Re-test actual boundaries rather than implementing against an outdated checklist.

**Visible retraction:** the earlier recommendation to keep the CLI as the normal lifecycle and add cards opportunistically does not meet the user's integration goal. Keep optional backends, not competing UX/permission models. Global/session automation is a proposed explicit-grant capability, not existing behavior or authority inferred from the user's design choice.

## Architecture

See ADR 0010 for detailed semantics. Proposed boundaries:

| Boundary | Responsibility and reuse |
| --- | --- |
| Configuration resolver | One versioned schema, field origins, global/project/session inheritance, task snapshots, restrictions/capabilities, migration. Evolve `git-workflow-policy/store`; retire competing preference ownership. |
| Authorization controller | User-created scoped grants, one-time decisions, revocation, effective feature gates, no authority from repository files or model arguments. Shared by routes and tools. |
| Workflow coordinator | Bounded workflow IDs, workspace bindings, start/transition/finish state machine, stage gates, idempotent actions and reconciliation. Reuse transition/checkout/session-move primitives. |
| Action journal and artifacts | Durable intent/outcome, immutable bounded patch data, non-context transcript anchors, independent live capabilities, recovery/retention. |
| Git backends | Existing native engines first; capability-reported optional CLI adapter; explicit manual/handoff when semantics are unsupported. No generic shell escape hatch. |
| UI projections | One Workflow home with Global/Project/Session selector over the same stage rows, current-task status, focused action views, durable timeline cards and multi-file split diffs; independent read-only Explorer. No second general Settings editor. |
| Instruction adapter | Minimal effective-state guidance in Pi Web; conditional harness-aware lifecycle in Nix-managed global instructions and project profiles. |

The frequent primitive is a policy-aware `git_commit`; `git_workflow` coordinates status/setup/start/verify/review/finish/cleanup. Legacy entry points become aliases, not independent consent systems. Final argument shapes should be proved with the first vertical slice.

## Original plan (superseded; historical checkboxes)

### A. Accept the contract and close risky unknowns

- [x] Investigate current settings, tool, transcript, SDK, and Nix instruction ownership; record source evidence and the prior recommendation's retraction in ADR 0010 and this plan.
- [x] Record the user's confirmation that tools should execute/ask/refuse under effective policy and the subsequent single-Workflow-home UX requirement; withdraw the separate `Settings → Git workflow` proposal in ADR 0010.
- [x] Create the isolated sample-data [visual prototype](assets/integrated-git-workflow.html), [desktop study](assets/integrated-git-workflow-desktop.png), and [mobile inheritance study](assets/integrated-git-workflow-mobile.png). Evidence: local Chrome through an isolated `agent-browser` session, dark 1220×1000 and light 390×1100 viewports; prototype assertions passed for scoped save labels, draft retention, saved-parent inheritance isolation, reset-to-inherit, unchanged task choices, selected-scope-only save, single expanded row, and mobile horizontal containment. No browser errors reported. This is not application E2E or backend verification.
- [x] Review the concrete one-panel UX using [the prototype](assets/integrated-git-workflow.html) and desktop/mobile studies; record the subsequent explicit implementation go-ahead in ADR 0010. Source implementation is authorized; live grants and repository lifecycle approvals are not.
- [ ] Specify a capability/authorization matrix in `lib/` design fixtures covering Off/Manual/Ask/Automatic, global/project/session origins, read-only/Chat-only/subagent sessions, and repository restrictions; acceptance is a reviewed truth table with no route/tool mismatch.
- [x] Spike crash-safe action journaling around commit ref/index update and integration apply using disposable repositories; acceptance is fault-injection evidence distinguishing unchanged, committed, partial, and uncertain results without duplicate execution.
- [ ] Audit session startup, move/fork, active terminals/subagents, and malformed-session inventory against checkout admission; acceptance is reproducible adversarial tests and an explicit list of remaining cleanup blockers.

### B. One configuration and permission model

- [ ] Implement the shared resolver and versioned global/project/session storage in `lib/git-workflow-*`; test field origins, explicit none/off/empty versus inherit, canonical worktrees, list ordering, revision conflicts, task snapshots versus live tightened restrictions, and source-digest changes to adopted project profiles.
- [ ] Implement user-origin standing grants and live revocation through authenticated settings/actions routes; test that repository definitions, forged tool arguments, stale settings, imported records, and old approval IDs cannot create authority.
- [ ] Enforce feature gates and the separate pause-all control at dispatch and execution boundaries; test loaded wrappers, pending approvals, queued actions, cancellation during checks, and revocation during a non-interruptible apply boundary.
- [ ] Build non-widening migration for both old policy namespaces and legacy absent/null/pinned states; test conflicting target/check/mode values, unsupported methods, unknown newer records, and downgrade refusal without resurrecting old consent.
- [ ] Build the single Workflow home editor with a Global/Project/Session scope selector above reusable stage rows, field provenance, inheritance traces, and scoped save/grant summaries; browser-test no-chat/non-Git access, unsent initialized chats, enabled/reset/off behavior, close/reopen, per-scope draft retention, unsaved-parent isolation, chat/project identity changes, cross-tab stale saves, presets, and explicit adoption without a separate Settings page.

### C. Durable actions and a complete commit slice

- [x] Add a private action journal, immutable candidate artifacts, and non-context transcript anchors under `lib/`; test atomic writes, revisions, pre-apply artifact failure, post-apply recording failure, tampering/missing artifacts, and separate live capability lifetime.
- [x] Project cards through session reads, pagination, and revisioned SSE/GET reconciliation; test reload, missed events, compaction, alternate branches, fork/clone, moves, and surviving child references after session deletion without creating wrappers for history.
- [x] Adapt `CommittedPatchDiff` for lazy multi-file candidates and durable result cards; browser-test split/unified/raw, rename/binary/metadata/oversize states, declined patches after GC, removed worktrees, mobile scrolling, and accessible keyboard actions.
- [ ] Route `git_commit`, the legacy workflow commit action, and browser commit actions through the common authorization/controller; test automatic commit without approval, Ask mode approval/decline, Manual refusal, exact candidate identity, author reporting, and partial success.
- [x] Verify the model-context boundary using actual SDK context construction: full card state/patches stay out, while concise result facts remain; ensure UI state changes do not manufacture user messages or repeat summaries.

### D. One start-to-finish workflow

- [ ] Introduce typed `git_workflow status/setup/start` and workflow-bound source selection; test missing-policy setup, complete-default nonblocking starts, no-target workflows, source/target mismatch, adopted resources, and deprecated workspace-start alias parity.
- [ ] Replace the three Git sidecars with the one Workflow home using the shared editor and task state; browser-test missing-choice setup in that same panel, one-time versus remembered choices, precise blockers, focused review/back navigation, linked durable chat cards, requests arriving during unsaved edits without focus theft, and Explorer selection that never retargets mutations.
- [ ] Generalize workspace transition receipts to per-workflow one-shot continuations; test stop/restart, managed fork ownership/authority transfer versus ordinary history forks, generation fencing during a crashed handoff, fresh destination resources, no edits while transition is pending, partial fork/move, duplicate settlement, and a second task in one chat.
- [ ] Add recipe-aware verify/prepare/finish orchestration over existing guarded engines; test explicit task boundaries, refusal to silently commit remaining changes, exact final-candidate receipts, environment/subdirectory launchers, required/conditional checks, changed command definitions, failed-check modifications, and no redundant fresh check-permission request under a matching grant.
- [ ] Implement capability preflight and a reviewed optional CLI adapter spike; test native parity, adapter absence/version mismatch, ref/path binding, evidence provenance, unsupported signing/hooks/attributes and additional methods, and no fallback after a safety denial. Do not advertise unsupported execution.
- [ ] Add automatic local integration only after grants/journaling/admission tests pass; test exact plans under Ask versus Automatic, source ownership, stale target re-planning bounds, revoked grants, instruction conflicts, and verified merge results. FF/squash require their own method-specific backend evidence before enabling.

### E. Safe disposition and cleanup

- [ ] Close the demonstrated startup/move/terminal/inventory admission gaps before deletion is enabled; acceptance is race coverage showing neither newly admitted writers nor missing inventory can be ignored, including server death during verification/adapter execution, surviving children, recycled PIDs, and workspace quarantine until owned processes reconcile.
- [ ] Implement exact-resource cleanup with independent Ask/Automatic authority, workflow ownership, integration evidence, idle chat relocation, and artifact inventory; test dirty/unmerged/locked/rebound resources, unknown ignored files, symlink boundaries, active users, cancellation, and partial filesystem/ref failure.
- [ ] Add artifact retention/export controls independent of workspace cleanup; test declined/unreachable patch persistence, retained fork references, missing/pruned placeholders, explicit deletion, and no silent disclosure through ordinary exports.

### F. Align instructions and deploy deliberately

- [ ] In a separately authorized Nix feature worktree, adapt `home/presets/pi/AGENTS.md` and `home/presets/skills/git-worktrees/SKILL.md` to capability-negotiated host authority with conservative CLI fallback; fixture-test native tools present, old/absent tools, disabled workflow, denied action, and a stricter project profile.
- [ ] Update the Nix `project-workflow-align` baseline/templates and `docs/guides/git-workflow.md` only as needed for the new conditional contract; verify no bulk project rewrites, mandatory Pi Web dependency, or changed standalone adapter consent is introduced.
- [ ] After explicit policy acceptance, revise Pi Web `AGENTS.md` and maintained Git guides to name permitted standing authorization while retaining worktree/target/method/check/no-build/remote constraints; test guidance generation against the actual runtime's effective permissions and gate the advertised integrated-automation rollout on compatible loaded instructions, not merely a feature flag.
- [ ] Verify Nix packaging/instruction checks with the affected `git-worktrees-skill` and any changed `git-workflow`/`git-helpers` checks, plus applicable repository checks; stage activation separately and inspect effective loaded context after activation. Do not reseed mutable workflow grants/settings from Home Manager on every activation.
- [ ] Run Pi Web focused suites, then `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and affected `npm run test:e2e`; run terminal checks only if terminal integration changes. Never run a production build for this development task.

## Original acceptance scenarios (superseded)

| Scenario | Required experience/evidence |
| --- | --- |
| Configured automatic eligible project | No repeated setup, check-permission, commit, integration, or cleanup prompts inside the granted scope; every action has a durable truthful result. |
| Assisted project | One setup only if needed, automatic allowed commits, exact-candidate integration approval; no duplicate prose question for the same decision. |
| Global/project/session configuration | One Workflow entry and the same stage rows at each scope; value/source, reset, save destination, and downstream overrides are explicit. No Settings detour or giant three-column form. |
| Drafts and active-task settings | Scope/panel/review navigation preserves correctly bound drafts; saves affect only the named scope; unsaved parents do not change inherited displays; the current task does not silently adopt new defaults. |
| Desktop/mobile and no-chat | Theme-aware readable layout, keyboard/touch access and contained diff scroll; Global and Project remain configurable without starting a chat, including while workflow execution is disabled. |
| Mandatory human-review project | Automatic global preference resolves to required review with a source/reason; the tool cannot bypass through another backend. |
| Existing chat with no old policy | Explicit adoption offers the unified setup; absence never silently acquires broad authority. |
| Direct/current-branch work | Selected commits work without a fake integration/cleanup stage or forced worktree. |
| Worktree task from a primary-chat cwd | One bound feature identity; optional managed continuation resumes once; no manual “move then retry” maze. |
| No local integration / PR handoff | Feature and evidence retained; no inferred remote operation or merge. |
| Nix/Maven/monorepo/custom environment | Named authorized recipes with real cwd/environment; no Node/main assumptions. |
| Hooks/signing/unsupported Git state | Early exact explanation and supported handoff; no disabling policy for convenience. |
| Read-only / disabled / subagent | No unintended mutation authority; historical cards/Explorer remain readable where enabled. |
| Reload/restart/fork/compaction | Correct historical diff/outcome; pending controls only for original live capabilities; no executable replay. |
| Unknown cleanup artifact or busy writer | Precise retained-resource blocker, not force removal or repeated blind retries. |
| Shared global instructions without Pi Web | Conservative interactive lifecycle still works; no nonexistent tool or fictional grant. |

## Non-Goals

- The first Pi Web implementation slice does not implement standing grants, durable cards, automatic integration/cleanup, per-task workspace ownership, or the Nix instruction adapter. Those remain later work under this plan, not silently supported controls.
- No implicit remote fetch/push/PR creation/publication/deployment, force cleanup, hidden stashing, Git configuration changes, or external-process sandbox claim.
- No mandatory machine-readable repository file, automatic AGENTS rewriting, cross-repository atomic transaction, or broad shell recipe authority.
- No promise of universal hooks/signing/LFS/submodule/Windows support from a schema alone; unsupported execution stays explicit.
- No replacement of unrelated `ask_user` dialogs, general session formats, or the read-only Git Explorer.

## Risks and rollback / recovery

Permission migration and changed global instructions are the highest-risk boundaries. Roll out automatic capabilities only behind their reviewed authorization/capability gate, with conservative defaults, explicit adoption, and no implicit grants. Preserve original old records; newer unsupported authority must disable execution rather than fall back to an older permissive entry. A rollback can remove tool/UI exposure while keeping action artifacts and actual Git results.

An interrupted mutation is not safely retryable merely because a dialog or process ended. Retain intended/result OIDs, phase/recovery evidence, candidate patches, and feature resources; reconcile manually where completion cannot be proved. Never undo successful Git operations, delete resources, or reactivate consent automatically to make a downgrade succeed.

Instruction edits land after a compatible runtime is available; conditional fallback must support older/other harnesses. Nix activation is separate from a local source merge. Existing project rules are not relaxed by saving this plan.

## Original completion checklist (not the active queue)

- [ ] ADR 0010's final behavior is explicitly accepted, with unresolved decisions closed or clearly deferred.
- [ ] One resolver and authorization controller governs all enabled tools and manual mutation surfaces; old configurations migrate without widening consent.
- [ ] Global/project/session enablement, defaults, overrides, provenance, revocation, and pause behavior pass tests.
- [ ] The single Workflow home, scope selector, inheritance/reset/save interaction, and focused task reviews pass the acceptance scenarios without duplicate editors/questions or a general Settings dependency.
- [ ] Commits and decisions retain multi-file split diffs/outcomes through reload, history navigation, compaction, fork, and workspace removal without patch-sized LLM context.
- [ ] Automatic integration/cleanup is enabled only for capability-supported, fully verified, independently authorized cases; crash/race/partial-state tests pass.
- [ ] Nix-managed guidance, project instructions, runtime capability claims, and maintained docs agree; deployment/activation evidence is recorded where performed.
- [ ] Required code/browser tests pass on the exact implementation candidate; each repository's integration, publication, and cleanup has its own applicable authorization.

## Design-artifact handoff

Work continues on `docs/integrated-git-workflow` in `/home/robert/projects/3rdparty/pi-web-worktrees/integrated-git-workflow`. Before source edits, the branch was advanced without losing its documentation drafts from `f9c5f468bd81efccfa5959ee431bd9282eaf0cbf` to the then-current local `rst-main`, `d5e434d`. No Nix sources or installed instructions are changed. Record source/browser verification and commit/integration status below; do not check broad implementation items merely because a partial slice exists.

## First application slice

- Unified Workflow home and shared Global/Project/Session fields; versioned private settings in `pi-web/git-workflow-settings.json`, canonical project identity, provenance, explicit reset/off/none/empty, scope-bound optimistic revisions.
- Session v2 metadata separates overrides for later work from captured current-task choices. Applying saved settings is explicit and idle-only. New sessions capture defaults; legacy snapshots remain pinned. A v1 opt-out tombstone prevents older runtimes resurrecting old agent-commit consent after v2 adoption.
- Imported v1 project defaults remain readable without overwriting the old file; legacy automatic commit defaults become Ask for new managed sessions. Existing legacy session grants remain unchanged. Legacy preference cards cannot override managed task choices.
- Managed commits support Off/Manual/Ask; `git_commit operation: commit` and the workflow commit alias use the same exact-candidate human approval. Global/session disablement, commit Off, and unconditional pause are checked by loaded tools and browser mutation routes; cancellable checks observe revocation. Read-only/Chat-only agents and subagents receive no managed mutation authority.
- Existing exact-state engines, separate check/merge approvals and one-shot worktree transitions are retained. New managed worktree starts collect approval. No new standing authority, automatic finish, cleanup, remote operation, or executable replay is introduced.
- At the first-slice boundary, remaining work in B–F included durable history/diffs, robust per-workflow ownership/recovery, recipe environments, automatic modes and instruction alignment. The Session scope currently requires a persisted chat; defaults remain usable without initializing one.

### Verification evidence

- `npm test`: 1,611 tests passed; `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed.
- `E2E_SERVER_MODE=dev E2E_GIT_WORKFLOW_ONLY=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<installed Chromium> npm run test:e2e`: passed against an isolated Turbopack server and disposable Git repositories. Covered no-chat Global/Project saves without agent creation; inherited/reset/off/empty semantics; retained drafts and unsaved-parent isolation; captured-task comparison/adoption; pause/disable accessibility; desktop/mobile containment; real whole-file commit, ordered verification, exact unsigned non-FF merge, chat continuation and Git Explorer's merged history. Zero browser errors.
- Runtime regression tests cover post-approval pause, stale legacy confirmation after disable, unpinned SDK read-only defaults, source branch/worktree requirements, Stop during asynchronous preflight, and repository-subdirectory worktree-gate bypass. Settings revisions ignore unrelated streaming messages so safety pause/defaults saves do not continuously conflict; real configuration changes still conflict.
- The E2E runner isolates HOME and Git identity. An initial external dependency symlink was rejected by Turbopack; a local copy of the identical-lockfile dependency tree resolved it. The primary port-30141 process was not restarted. No production build, remote operation, terminal change, Nix source edit or activation was performed.
- Actual application screenshots are retained as ignored local evidence under `test-results/e2e/workflow-overview-1280.png` and `workflow-overview-390.png`; the tracked `assets/` studies remain clearly labelled design prototypes. Draft retention is in-memory across navigation/closure, not across a browser reload. Action cards were still transient at that boundary; the durable-card slice is recorded below.
- This is a reviewable first vertical slice, not completion of the full end-to-end automation plan. Feature resources remain subject to separately approved integration and cleanup.

## Durable-card slice

The user selected **Implement durable cards next**, on the existing feature branch after commit `14ef06b`. This authorizes the next source slice, not integration or new standing execution authority.

1. Persist versioned private action records and immutable, digest-checked candidate artifacts before presenting an actionable candidate. Append only a small plain SDK `custom` anchor; never a provider-visible `custom_message` or patch-sized transcript entry.
2. Instrument existing agent and human commit, review, verification and integration paths. Retain their exact-state engines and approvals. Record prepared commit identity before the ref update, distinguish decisions from outcomes, and report known partial/recording failures without suggesting a blind retry.
3. Project one coalesced chat card through history/pagination and minimal SSE updates; reconcile missed/manual events without creating wrappers. Lazy multi-file split/unified/raw views read captured artifacts, not current Git objects or checkout files. A historical record cannot recreate live approval controls.
4. Prove the SDK context boundary, immutable history after Git/workspace disappearance, fork references, cancellation/expiry and failure boundaries with disposable tests; then run common checks and isolated desktop/mobile browser flows.

This slice does not add standing grants, orchestration, cleanup, automatic recovery, artifact export/retention controls, or a check-log viewer. Native check logs remain private in their existing engine storage. Worktree creation/continuation and legacy preference editing still use their existing live UI, not this action-card journal. Missing or incompatible artifacts render an explicit unavailable state. C's automatic-commit/grant acceptance remains open; existing legacy-consented commits are recorded without introducing new authority.

### Verification evidence

- `npm test`: **1,713 tests passed**, zero failures, with an isolated `PI_CODING_AGENT_DIR` and empty test-only `PI_WEB_PASSWORD`; TypeScript, ESLint and diff whitespace checks passed.
- Full `E2E_SERVER_MODE=dev PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<installed Chromium> npm run test:e2e` passed, not just the Git subset. Covered real manual multi-file commit, checks and non-FF merge; live journal ownership shared across Next route modules; immediate card reconciliation without idle SSE; reload and chat move; tag-labelled Git graph; desktop/mobile split/unified/raw, keyboard expansion, rename/binary/metadata history, explicit oversize/missing data and expired/uncertain records from another server process. Existing pagination, branch restoration, compaction, extension questions, file editing, accounts and mobile session flows also passed.
- Native/controller fault tests prove artifact and intent-write failures prevent ref/checkout updates, prepared IDs are not success, known post-commit recording failures report the actual OID, and unknown post-boundary errors require recovery instead of retry guidance. Native partial-state tests and browser-route tests retain actual versus intended result distinctions. Bounded immutable declined artifacts survive real Git GC and removal of disposable repositories.
- Actual SDK context/branch/fork tests prove plain anchors remain outside model context while `custom_message` does not. History-route tests authorize a child's copied reference after owner deletion without creating wrappers. Pending manual candidates require their original process-only binding; history IDs cannot reconstruct it.
- Review fixes include fresh manager resolution at browser anchor append, refusal of disk-ahead/moved source managers, equal-revision liveness regression prevention, retaining paged ancestors only for an exact branch suffix, protected navigation/read races, minimap indexing, and stopping periodic rereads of immutable terminal cards.
- Browser screenshots are ignored local evidence in `test-results/e2e/git-action-history-1280.png` and `git-action-history-390.png`. The primary port-30141 server remains untouched. No production build, real target integration, publication, feature cleanup, Nix changes or activation occurred.

### User-requested Git Explorer addition

While this slice was finishing, the user also requested tags in Git Explorer. Local lightweight/annotated/nested tag labels now decorate matching commit rows, separately from branch labels. A single bounded local tag read handles names without comma-delimited decoration parsing; noncommit targets are ignored. Branch-only selection and reachability authorization are unchanged. Refresh updates these per-page labels; no tags are fetched, created or used as execution authority. Backend, component and browser coverage passed.

The user approved this slice as `c32fb8169d9840ed1480b77d854c04094f8688e3` (parent `14ef06b`, author `robert@projektbuero.at`). Both source and primary checkouts were clean afterward. No integration or publication was performed.

## Authorization prerequisites (completed prerequisite slice)

The user's “continue with the roadmap” authorizes further source work on the existing feature branch, not integration or live grants. The initial intent to add grant management and bounded automatic commits is **narrowed after the dependency audit**: a captured task is currently only transcript-backed settings, ordinary forks copy it, SDK context discovery can skip unreadable sources, and checkout admission does not yet cover terminals/startup/subdirectory aliases. An Automatic enum or bypass of `ask()` would be premature.

- [x] Extract one pure permission matrix used by live gates, tool status and the Workflow home; verify Off/Manual/Ask/unsupported Automatic, captured versus saved choices, field origins, Pause, read-only/Chat-only/subagents and explicit human actions. A permission summary is not candidate approval or complete Git preflight.
- [x] Refuse native commits during existing Git operations, both before preview and immediately before ref update; test per-worktree metadata, clean-index paused operations, late operation markers, and unchanged refs/index.
- [x] Apply the existing checkout transaction gate to agent commits as well as browser commits, without holding it while waiting for approval; test busy gates, release/cancellation/failure, and preserve exact native validation. This does not claim complete writer admission.
- [x] Replace stale “requires durable action support” wording with precise remaining Automatic prerequisites; exercise desktop/mobile settings/status flows, then run the common checks and affected E2E.

Next authority work must introduce private human-origin grants, explicit task adoption/generations, reviewed source/dependency digests with fail-closed discovery, branch/identity restrictions, and final-apply/revocation ordering. Do not mint grants from legacy snapshots, copied transcript entries or action history. Global grant eligibility cannot equate the SDK's default-true resource-trust status with explicit human trust. Ordinary forks/moves initially need re-adoption; managed handoff, comprehensive admission, integration and cleanup remain later work. Source implementation cannot relax loaded instructions or deploy automation.

### Prerequisite-slice verification

- **1,764 tests passed**, zero failures, with isolated `PI_CODING_AGENT_DIR` and empty test-only `PI_WEB_PASSWORD`. Final TypeScript, ESLint and whitespace checks passed. The broad A–F acceptance boxes remain open: the implemented matrix describes current availability, not future adopted-rule or grant authority.
- Full isolated development E2E passed at 1280px and 390px; after review fixes the focused Git E2E passed again. Coverage includes keyboard-opened permission reasons, unchanged task facts while drafting another mode, disabled Automatic choices with accurate blockers, scoped saves/pause, real commit/check/non-FF merge, durable history, and unlimited Git-question waits. Ignored screenshots include `test-results/e2e/workflow-permissions-1280.png` and `workflow-permissions-390.png`.
- Native tests cover clean-index operation markers in main/linked checkouts, an actual empty no-commit merge, late markers before ref CAS, sibling independence, historical-ref non-blocking, unreadable probes and dangling symlinks. One new test caught Git's absolute `--git-path` following a marker symlink; resolving the worktree Git directory and lstat'ing the marker fixed it.
- Review found and resolved three evidence/label issues: retain approval when subsequent gate acquisition fails; treat the typed definite pre-CAS operation refusal as blocked after intent recording, not uncertain execution; label legacy workspace-start consent rather than promising a nonexistent fresh prompt. Ask/legacy/browser regressions verify retained intent, unchanged HEAD/index, no claimed outcome and preserved unknown-failure recovery. The read-only follow-up review found no remaining high-confidence findings.
- An initial full browser run timed out in the existing history reading-offset check; the unchanged repeat passed it. One unit assertion still expected the superseded Automatic wording and was updated. After browser testing, TypeScript found malformed ignored Next dev-generated route declarations; preserving those artifacts and running `next typegen` regenerated valid types without a production build. TypeScript and lint then passed sequentially. These are verification observations, not reasons to weaken tests or alter unrelated chat behavior.
- The installed port-30141 process remained PID 3542119. No live grants, integration, publication, feature cleanup, production build, Nix source change or activation occurred.
- The first exact 32-path commit request returned the installed tool's undifferentiated “declined or cancelled”; this did not identify the cause or establish that the user declined. After the user explicitly requested a retry, the approval tool created `cadcbcf86f8ebb3cabdbb127a09e350c21979179`, parent `65963bebd61c3f52e49152b009c290654cf5f51b`, author `robert@projektbuero.at`. Both checkouts were verified clean; primary `rst-main` remained at `d5e434ddcf7085ff2e0b68acc3070d1c2b0e5f54`. No integration or deployment occurred.

## Private task bindings and reviewed sources (current slice)

The user accepted the recommended next prerequisite and said “alright. continue.” Work stays on the existing feature branch from `cadcbcf8`. This authorizes source implementation only: no live grants, Automatic mode, integration, deployment, cleanup, instruction-policy relaxation or Nix changes.

- [x] Define and test private, versioned task adoption records binding a persisted ordinary session, explicit originating request/goal, captured settings, selected physical registered checkout and branch, with monotonic generations. Transcript copies, defaults and history must not create or recover a binding.
- [x] Capture bounded instruction-source snapshots and explicitly selected dependencies with fail-closed discovery, file identities/digests and truthful coverage limits. Verify unreadable/missing/changed/overriding sources, symlink retargeting, malformed/binary/oversized content and no implicit dependency execution or credential-file browsing. A reviewed source set is not proof that all prose restrictions have been normalized.
- [x] Add explicit preview/adopt and read-only status to the same Workflow home, without repurposing `scope:task` settings capture as authority. Review names the exact source set and task/workspace; a single action-specific confirmation is sufficient. Never initialize a wrapper, start a coding task or approve a Git action while reading/adopting metadata.
- [x] Prove stale preview/generation refusal, concurrent adoption, restart/copy/fork/move isolation, unchanged existing Ask/Manual/legacy behavior and desktop/mobile accessibility. Run common checks and affected browser E2E, then record the exact review/commit boundary.

Normalized executable rule restrictions, scoped grants/revocation, comprehensive writer admission, managed ownership transfer and automatic progression remain later work. Records in this slice are preparation/evidence, not runtime grants or exclusive workspace ownership. Unknown rule coverage cannot be advertised as automation-ready.

### Binding/source slice decisions and verification

- One private current binding slot per session, with a fresh UUID for each explicit adoption and monotonically increasing generations across adoption/release/invalidation. Immutable snapshots bind the physical session/header and current-branch user request/goal, captured settings, selected physical registered checkout/branch/Git directories and reviewed source evidence. Copied/imported/default/custom entries cannot create a binding. No source bytes or metadata anchors enter SDK context, and no wrapper, task start, continuation, Git action or grant is created by review/adoption. Existing Ask/Manual/legacy paths remain unchanged.
- The source contract is pinned to SDK 0.87.1, including all five candidate names, absent higher-priority candidates, and nested-worktree shadowing. Explicit dependencies are bounded Markdown files, never recursively followed links or executable resources. Linked destinations require exact file selection before content reads. Selection-critical shadowed documents are readable probes, not claimed loaded context. Directory/file identities and digests fail closed on changes, invalid UTF-8, binary/nonregular/unreadable or oversize content. Secure capture is explicitly Linux-only with `/proc/self/fd` parent descriptors and pre-read identity checks; there is no weaker portable fallback.
- Common-lock capture/adoption and a private durable settings-write epoch fence cross-process equal-value round trips and confirmations already waiting for the lock. The compatibility settings route participates too. Copies/forks/restarts require new review; moves and settings recapture invalidate before writes, and failed moves do not revive bindings. Private schema/digest/CAS validation, tombstones, immutable artifacts and directory syncs never reconstruct missing heads or replay publication. These are not grants, complete policy interpretation or exclusive writer admission.
- **1,800 tests passed**, zero failures, with isolated agent state and an empty test-only web password. TypeScript, ESLint, whitespace and Markdown fence/local-link checks passed. Full isolated development E2E passed, then focused Git E2E passed again after lint-only cleanup. Desktop/mobile coverage includes goal/request/checkout selection, successive A→B linked-destination disclosures, complete inert source text, stale confirmation refusal, fresh adoption IDs/generations, release and reload; existing real selected-file commit/check/non-FF merge, history and indefinite Git waiting still pass. Screenshots: `test-results/e2e/workflow-task-source-review-1280.png` and `workflow-task-source-review-390.png` (ignored local evidence).
- Independent read-only reviews found and resolved parent-retarget reads, unreadable shadow omission, multiple-shadow schema mismatch, successive mapping loss, settings roundtrip/lock races, compatibility-write epoch bypass, and skipped parent barriers after a failed mkdir/fsync. Isolated re-probes now reject before unselected bytes are read and re-establish all required barriers. Final reviewers reported no remaining high-confidence findings. Power-loss behavior was not physically simulated; fault injection exercises publication boundaries and retained actual generations.
- Verification fixes were limited to test harness accuracy: Jiti-cached filesystem imports require module-local fault injection; an empty registry Map is not an AgentSession; re-adoption intentionally creates a new private binding ID; expected 409 browser diagnostics are narrowly consumed only for declared task-review requests; post-publication failure injection keys the actual generation rather than incidental sync call counts. Final source checks and documentation validation are recorded with the exact feature checkpoint, not treated as permission to integrate or deploy. The installed port-30141 runtime and primary checkout remain outside this source slice.

The first exact 31-path commit request for this binding/source slice returned the installed tool's undifferentiated “declined or cancelled; no commit was made.” Its cause was not established. Immediately afterward, feature HEAD was verified unchanged at `cadcbcf86f8ebb3cabdbb127a09e350c21979179`, all 31 changed paths were retained, the index was clean, and primary `rst-main` remained clean at `d5e434ddcf7085ff2e0b68acc3070d1c2b0e5f54`. No automatic retry, integration or deployment followed that result. The user later explicitly requested “commit again”; that authorizes a fresh exact commit approval, not integration or an agent-run system rebuild.

## Follow-up: human Git decisions without timers or redundant review gates

The installed 0.9.3 runtime returned “Commit declined or cancelled” after approximately 302 seconds on two requests. Inspection confirmed a hard-coded five-minute Git UI timeout whose default `false` result was indistinguishable from decline. The user explicitly said it should always wait, then asked to commit the existing work first; `c32fb816` is that boundary. **Retraction:** the agent's earlier attribution of cancellation to the user was unsupported. The timestamps strongly indicate automatic expiry; old logs do not establish browser delivery/visibility.

The user additionally requested removing the review checkboxes: explicit buttons are enough. Remove the equivalent manual merge acknowledgement-button gate as well; retain file/check selectors, separate check/merge permissions and all native revalidation.

- [x] Remove only the response deadline from `gitAction`/`gitPreferences`; verify pending questions remain unresolved past a day of simulated time, replay across disconnects, and still settle once on response, Stop/signal or teardown. Explicit generic extension timeouts remain supported.
- [x] Explain unlimited response waiting in the live card and distinguish it from verification-plan expiry; browser-test reconnect/reload, approval/decline and Stop without generating Git mutations from the UI fixture.
- [x] Remove redundant review acknowledgements from agent cards and the manual merge proposal; test direct explicit approval and retained missing-authority/stale/busy/blocked guards. Manual commit already uses a single confirmation button.
- [x] Run focused/common checks and affected desktop/mobile E2E; update evidence before the follow-up commit. Do not alter native receipt/plan freshness, manual browser-preview lifetime, execution timeouts, restart safety, installed runtime or Nix configuration.

Verification: **1,741 tests passed**, zero failures, in an isolated agent directory; TypeScript, ESLint and diff checks passed. The 27 real-wrapper regressions simulate a day offline, repeated idle deadlines, original-request replay, delayed approval/decline, invalid/late answers, Stop/signal/destroy/shutdown and unchanged explicit generic timeouts. Against a temporary copy of the `c32fb816` wrapper these produced 22 expected failures while all five generic-timeout tests passed. Full isolated development E2E passed at 1280px and 390px, including real commit/non-FF integration without an extra review gate, and an approval-only UI fixture proving no response-deadline metadata, reload/SSE replay, direct approval, decline, Stop and ignored late replies without executing its displayed command.

Initial browser runs exposed test-selector mistakes (Stop is a title and mobile composer controls need opening); those were corrected without forced clicks or weaker assertions. One earlier full run hit a 404 in the pre-existing lazy-thinking fixture; subsequent full runs passed that step without application changes there. One suite run exposed a nondeterministic pre-existing index-staleness fixture: `git add` of an untouched file can leave identical index bytes. The fixture now explicitly changes only stat metadata and asserts the index bytes actually changed while staged contents did not, before asserting refusal. The final full suite and full browser run passed. No native transaction/expiry policy was relaxed.
