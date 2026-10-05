# 0011 — Project policies and agent-driven Git operations

> Historical decision: superseded by [ADR 0014](0014-remove-managed-git-workflow.md). Managed Workflow is removed; this document does not define current runtime behavior.

## Status and reading guide

**Live-settings supersession, 2026-10-04:** [ADR 0013](0013-live-git-settings.md) now owns live Global → canonical Project → Chat × Project settings, retiring captured tasks, task Apply/adoption, early preference writers and automatic workspace/chat transitions. Core source is migrated; origin hardening and cross-scope consent acceptance remain in progress. The earlier status and body below are historical, including their “not yet implemented” and idle-only settings claims; Phase 6 acceptance is not Phase 7 or installed validation. [The guide](../git-workflow.md) is the maintained source contract. ADR 0012's independent invocation safeguards and separate permissions/checks remain unchanged.

**Supersession notice — concurrency revision, 2026-10-03:** [ADR 0012](0012-optimistic-git-invocations.md) supersedes this record's application reservations, repository-wide quarantine/history admission, foreign receipt fencing, placement/cleanup leases and mandatory diagnostic persistence, including section 7. Independent authorization, required checks, original physical/exact-candidate validation and native Git locks/CAS remain mandatory; there is no automatic target-movement retry/rebaseline or chat relocation. The body below is preserved as **historical rationale and earlier implementation evidence**, including its “implemented” claims, not the current concurrency/recovery contract. Phase 6 final source `2ccc381` passed 3,211 tests / 5 skipped, typecheck/lint, 25 containment cases (5 actual OS cases) plus 8 real-backend independent cases, 20 browser scenarios and terminal checks at 1440×900 / 390×844. It was explicitly integrated by unsigned non-FF merge `1a48d0e`; its feature worktree/branch and five ignored artifact entries were separately approved and removed. The user subsequently rebuilt the system; the current `/nix/store/a32ya4fhd9hphp96g3r04qvfdnvz4rp1-pi-web-0.9.3` package and SDK 1.0.0 were verified. However, live selected-tool metadata `workspace: current` returned `selected-runtime-unavailable` for `task: none`. Source/disposable-fixture acceptance does not prove that production entry path. Phase 7 of the sole coordinator-owned plan owns real entry wiring and the authorized removal of the entire redundant task layer; live settings are not fully unified yet. Settings-proposal Apply/Dismiss and own-session idle persistence guards remain distinct from redundant task Apply. See the [guide's release-boundary notice](../git-workflow.md#source-support-versus-installed-behavior). This status update supersedes the historical acceptance-pending and lifecycle-status claims below, not their recorded evidence. No production build is expected during development; repository/global safeguards and live consent are unchanged, and prior integration/cleanup approvals authorize no new lifecycle action.

**Accepted product direction, 2026-09-29; source implementation update for Phases 2–5.** The user clarified the intended experience after using the integrated Workflow panel and requested a design update before further implementation. This record supersedes the incompatible future direction in [ADR 0010](0010-integrated-git-workflow.md), especially mandatory task/workspace binding, session handoff, and host-driven start/finish orchestration. It also revises the eventual same-repository limitation of [ADR 0009](0009-cross-worktree-agent-git-tools.md). The bounded selected-operation source now implements these core capabilities; that is not installation, activation, permission migration or full-suite acceptance.

Start with **The intended experience** below. [Git workflow](../git-workflow.md) describes what is implemented today. The [policy-driven Git tools plan](../plans/2026-09-29_policy-driven-git-tools-plan.md) is the sole active implementation roadmap; the previous plan retains historical evidence.

This decision does not change saved permissions, relax original instructions, or authorize integration, cleanup, remote operations or deployment of this feature. Its source work is separate from permission to integrate into `rst-main`, remove this feature's resources, publish/install, change Nix/instructions or activate live policy. The current global Git lifecycle and repository safeguards still apply.

**Implemented source boundary:** `git_workflow` now dispatches selected workspace, prepare, verify, integrate, cleanup and reconcile through native engines, live independent action authorization, physical identity checks and sealed durable journal/admission. Whole-file and explicit staged commits are supported. Selected operations use the chosen project's policy without task adoption or session transition, including positively verified non-Git callers; caller negatives still clamp cross-project requests. Every actual rewrite returns to the agent with a process-only unpredictable dependency; a no-op cannot renew it, and explicit independently proved reconciliation carries zero receipts. Cleanup remains retain by default and needs authentic create/integration facts plus continuous positive idle-use proof, including terminal and persisted-chat inventory. The focused [guide](../git-workflow.md#selected-operations-current-public-contract) owns exact public fields, versions, operational bounds and remaining public/native diagnostic limits. Earlier “foundation only” comments and narrower capability summaries are historical subslice descriptions, not evidence that connected engines remain unimplemented.

Focused native/runtime results are implementation evidence, not acceptance of the entire source suite; the coordinator's settled full-suite result is required for that claim. Future backlog is distinct: Automatic scheduling, background retries, remote delivery/publication, complete prose-policy interpretation, Windows-equivalent native support, artifact retention/export controls and installation/instruction alignment are not implemented or authorized here.

## The intended experience

**Tell the agent what to do. Configure recurring Git decisions once. Let tools perform the mechanics and report results, while the agent remains responsible for the work.**

A conversation can work on two branches in one project, or several unrelated repositories. It normally stays where the user opened it. Creating or selecting a worktree does not require moving, forking, adopting or restarting the chat. Existing session move/fork controls remain optional conveniences.

Examples of project policies:

| Project | Where changes are made | How changes are delivered |
| --- | --- | --- |
| Small or greenfield project | Directly on its explicitly named main branch | Selected commits; no artificial merge/cleanup stage |
| Parallel local project | New or explicitly selected feature worktrees | Rebase against the moving local integration target, assess and verify, then FF-only or non-FF integration |
| Pull-request project | Feature branch/worktree according to its rules | Prepare and hand off for a PR; no local integration into the main branch |

For the parallel case, another feature may land while this agent is reviewing or testing. The agent can repeat preparation under saved permission without asking the same routine questions again. Every actual rebase returns control to the agent, including a conflict-free one. The tool cannot decide that rebased code is semantically correct.

**The clarified default is commits enabled with human commit confirmation off.** This does not mean disabling commits, skipping tests, or staging everything. Verification commands and their execution permission are independent. Users wanting more supervision can enable commit confirmation, globally or for a project.

The product gain is fewer repeated questions and fewer tokens spent reconstructing Git plumbing. It is not a new system for assigning conversations to checkouts.

## What changes from ADR 0010

| Earlier direction | Replacement |
| --- | --- |
| A workflow/task owns a workspace; session continuation is part of starting it | Each operation names its resources. A session can use many workspaces and projects without owning them. |
| A required goal/request/source-adoption ceremony precedes execution | No mandatory task binding or source adoption. Ordinary requests, caller capability and saved action permissions determine eligibility. |
| The host runs a start/finish state machine through later stages | The agent invokes bounded operations and decides the next step. Permission never schedules an operation. |
| Comprehensive prose-policy normalization is a prerequisite | The agent reads applicable instructions normally. Tools enforce supported structured limits and Git invariants; they do not prove interpretation of arbitrary prose. |
| New managed commits always ask | Newly enabled policy supports agent commits without human confirmation by default; existing explicit restrictions do not silently migrate to broader permission. |
| One captured task target/check list governs the chat | Policies resolve for the selected repository; exact action snapshots prevent retargeting while an operation is pending. |
| One generic integration stage | Delivery, preparation/rebase, verification, integration method and their permissions are independent. |

Retain the shared settings resolver, one Workflow panel, field provenance, draft preservation, live pause/revocation, immutable action artifacts, truthful outcomes, and exact ref/index/checkout validation. Existing private task/source records remain non-authoritative historical evidence; their presence or absence must not gate the replacement tools. No destructive data migration is implied.

## 1. Conversation, project and operation are different scopes

- **Conversation:** provides the agent interaction and action-history location, not an exclusive Git workspace or an automatic grant for every project it mentions.
- **Project:** a canonical repository identity shared by its linked worktrees. It owns reusable branch, delivery, verification and permission settings.
- **Operation:** an explicitly requested bounded action against concrete resources, with captured policy, refs/index state, an action ID, authorization basis and result.

Tools accept an explicit repository plus checkout selector, or a compact server-resolved handle representing those identities. Branch names alone are insufficient across repositories. Handles are conveniences, not authority; revalidate physical roots, registration, branch identity and allowed access before execution. A replaced/missing checkout produces a blocker, never fallback to the primary checkout or another same-named branch.

The chat cwd may supply a default only when the caller deliberately uses that default. There is no process-global or hidden "last used repository" that retargets the next call. Selecting a project in Workflow or browsing Git Explorer cannot retarget a pending operation. Cards identify the actual project and source/destination even when different from the chat cwd.

Selecting Git resources does **not** retarget bash, file tools, terminals, the SDK's loaded instructions or session storage. The agent still uses the intended directories and reads the relevant project's and subdirectory's instructions. No session move is needed to do that.

Cross-project access is explicit and subject to allowed roots, canonical identity, caller/tool restrictions, the selected project's policy, and relevant trust. File-browsing access is not execution authorization, and the absence of SDK trust-requiring resources is not proof of human trust for broad grants. Do not borrow another chat's consent or apply project A's target, checks or grants to project B. Each repository has separate operations and outcomes; multi-project work is not an atomic transaction.

## 2. Reusable policies without another task layer

Resolve fields through **Global defaults → Project overrides → Chat overrides for that project**. A chat exception is keyed by both chat and canonical project, so a multi-project conversation cannot accidentally copy `rst-main` or Node checks to a Nix repository. It is optional and is not a new required setup step. Old unqualified session records require a non-widening migration, not reinterpretation across every project in the chat.

Missing means inherit; explicit no target, empty recipes and disabled actions remain distinct. Preserve field provenance, explicit resets, revision checks, saved-parent inheritance and identity-bound drafts. Global defaults can choose "use the project's main branch"; they do not invent a branch name for every repository.

The selected project defines:

| Choice | Meaning |
| --- | --- |
| Main branch | Explicit local branch designated as this project's primary line; a name/reference, not necessarily the branch currently checked out in the primary worktree |
| Workspace strategy | Direct work on an explicitly selected branch, or create/use feature worktrees; no session relocation requirement |
| Creation base | Explicit local base, defaulting to the configured project main branch where suitable |
| Delivery | Local integration, pull-request handoff, or leave the branch for other handling |
| Integration target | Explicit local destination, normally the project main branch but independently configurable |
| Preparation | Whether rebasing onto the current local target is allowed and whether each rebase needs confirmation |
| Integration method | FF-only or non-fast-forward merge, with no implicit fallback between them |
| Verification | Named recipes, when they apply, and whether running them requires confirmation |
| Commit behavior | Agent eligibility, confirmation policy and explicitly selected changes; no implicit commit-all |
| Cleanup | Retain by default, or independently authorized deletion of exact eligible resources |

Direct work on the designated destination has no integration-to-itself stage. Checks must also work in direct-commit and handoff projects, without requiring a merge target or a second checkout. Checkpoint commits do not automatically acquire every integration check as a prerequisite. An empty workflow recipe list does not waive tests required by repository instructions; the agent remains responsible for performing them or resolving the conflict.

**Commit-stage evidence clarification, accepted during source implementation:** the user chooses checks of the **working workspace**, not an isolated checkout of the selected commit tree. Required commit-stage receipts bind the actual index and bounded tracked/nonignored-untracked working contents, including ordinary dirty state. Partial staging remains supported: an unstaged fix or unrelated staged change may be visible to a check but absent from the resulting commit. The implemented native receipt/snapshot v3 uses the physical working manifest v2. Approval summaries, receipts and durable outcomes therefore state `evidenceScope: working-workspace`, `candidateTreeVerified: false` and `repositoryChecksWaived: false`; they must not describe the selected commit tree as tested. Ignored dependency caches and external inputs are outside complete content coverage. Source-only clean-checkout v2 integration/handoff/manual receipts are a separate proof, not interchangeable with dirty-workspace v3 or paired legacy v1; their summaries likewise do not claim candidate-tree verification or a repository-check waiver. Required saved commit-stage recipes still apply to Ask, saved-Allow, manual and legacy-confirm paths independently of commit confirmation.

Pull-request and leave-branch delivery are **restrictions**: they prohibit local integration even if Global allows it. PR delivery is not permission to fetch, push, create a PR, force-push a rewritten branch, or merge remotely. These need a separate remote capability and authorization; initial tools can prepare a local branch and report the handoff. A project's PR base must not be confused with permission to update its local main branch.

## 3. Preanswered decisions, separate from action correctness

Keep these concepts distinct in both schema and labels:

1. **Availability:** is this action supported and enabled for this caller?
2. **Human confirmation:** must this particular requested action ask, or is it covered by saved authorization?
3. **Verification:** which project commands must run and what passing evidence exists?

"Commit confirmation: Off" means eligible agent commits can execute without a new human prompt. It must never map to the existing `commits: off`, which refuses commits. Likewise, a tests switch is not commit consent. The implementation may encode these as modes, but the user must not need to infer which meaning of "Off" applies.

Workspace creation, commit, rebase, verification, local integration and cleanup have independent permissions. Saving an explicitly described Allow policy records user-authorized scope and conditions; an agent argument, imported transcript entry or repository file cannot mint permission. No separate per-task grant ceremony is needed when an applicable saved policy already covers the operation. Users may choose a clearly described global scope for eligible projects, or narrow it by project/chat. New or unknown projects do not silently inherit authority outside that scope.

For newly enabled configuration, offer **agent commits enabled / confirmation off** as the default and make the effect clear at enable/save. Retain existing Ask/Manual/disabled choices and opt-outs. This design update alone grants nothing. Other action confirmations remain conservative until the user explicitly preanswers them; do not infer automatic merge or cleanup from the commit default.

Internally every action still captures an exact candidate and revalidates it immediately before mutation. In Ask mode a live human decision authorizes that candidate. In Allow mode the tool evaluates the current saved authorization against that candidate and records that basis, not "user reviewed". Neither mode can skip required checks or supported Git invariants.

Routine target movement may require another preparation attempt under the same saved rebase authorization. It does not transfer an old exact-candidate approval to new commits. If merge confirmation is enabled, the changed merge candidate needs fresh approval; if integration is preauthorized, its new candidate is validated against the still-current authorization without another human prompt.

Recheck live pause, revocation, caller capability, project delivery and scope at execution. Policy/recipe changes invalidate affected pending plans and evidence; do not broaden an in-flight action silently. Pause is not a default that a project override can cancel. Do not hold mutation locks during human waiting, or interrupt a ref/index update halfway to implement revocation.

Repository instructions remain binding. Tool selection cannot bypass a stricter required human review, forbidden rewrite, signing policy or protected target. Guidance and applicable always-ask rules must be explicitly aligned before advertising fewer prompts; a generic preference is not an exception. Comprehensive machine interpretation of prose is not required, and the tools must not claim they enforce every prose rule or confine arbitrary shell access.

## 4. Agent-facing operations and staging control

Use a small typed surface, retaining `git_workflow` for policy/status and bounded Git mechanics and `git_commit` for the frequent commit operation. The public TypeBox schema and selected-runtime allowlists are implemented; the focused guide documents their flat fields, rather than exposing private controller callbacks/proof handles. The operation families are:

| Operation family | Responsibility |
| --- | --- |
| Inspect/status | Resolve explicit project/workspace, settings origins, allowed actions, capabilities and actionable blockers |
| Workspace | Create a feature worktree, attach a selected existing local branch, or select a checkout, without moving a chat; selection alone starts nothing |
| Commit | Commit explicit changes and message, applying configured confirmation and exact-candidate validation |
| Prepare/rebase | One bounded attempt to prepare a source against a captured local target; return the actual outcome to the agent |
| Verify | Execute selected defined recipes in the explicit workspace/environment, retaining exact-candidate evidence |
| Review/integrate | Inspect or apply a candidate using the configured delivery/method/permission; no hidden rebase or commit |
| Cleanup | Inspect/remove exact eligible resources under separate permission; no automatic follow-on to a successful merge |

No mandatory workflow ID, goal selection, request adoption, `start`, managed fork or autonomous `finish` is required. Operation IDs and optional selection handles support concise calls, attribution, stale detection and duplicate protection—not exclusive workspace ownership. One conversation can alternate A/worktree-1, B/main, then A/worktree-2 without state leaking between them.

**Guidance is not a request to do Git work.** A chat with saved workflow settings is not automatically an active coding task. `git_workflow status` is optional discovery when the current request actually needs Git information, not a per-turn startup ritual or mandatory preflight. Ordinary conversation, rendered examples and read-only explanations must not trigger Git setup, status calls or permission questions merely because tools/settings exist. Actual repository changes still obey applicable instructions and operation-time gates; do not use a keyword classifier to decide whether those safeguards exist.

Keep conditional Git guidance in the instruction layer, not repeated synthetic user-task messages containing complete settings snapshots. On-demand status and operation results own the detailed state. Superseded app-owned Git reminders may be excluded from future model context without deleting raw transcript history, user text or unrelated extension messages; imported or replayed reminders never establish current authority.

The agent determines staging, commit boundaries and messages. Support deliberately selected whole-file changes and an explicit staged-candidate path for partial/hunk staging. Never hide `git add .`, commit every dirty path on "finish", unstage unrelated work, or overwrite an index to make the request succeed. An explicit staged mode must name/validate its selected index content, preserve unstaged hunks and unrelated staged changes, and reject mismatches. If a backend cannot preserve those semantics, report the unsupported mode before changing anything. Whole-file selection must not silently widen a partial staged selection.

`lib/git-commit.ts` now implements both whole-file and explicitly selected staged candidates, preserving unrelated staged content and unstaged hunks. The common verification gate enforces every saved source-Project required commit-stage recipe regardless of Ask/Allow/none, manual or legacy entry path. Check permission remains independent: check Deny can block a commit that requires checks; genuinely no required commit recipe yields only a truthful no-required summary, never a waiver. Unsupported/denied tool actions must not invite a consent-bypassing shell fallback.

Return short structured facts: action ID, canonical resource identity, before/after OIDs, result, changed-commit/diff handles, next mechanical prerequisite, and precise blocker codes. Full patches and logs remain on demand. Remove unnecessary human acknowledgements of read-only comparisons. The model need not reconstruct the subprocess sequence or receive patch-sized tool results to use the helpers.

## 5. Serial integration against a moving local target

The required property is **parallel development, serial target updates**, not a one-time "rebase before merging" checkbox.

```text
Capture selected source and latest local target
  → prepare / rebase if necessary and permitted
  → RETURN TO AGENT after every actual rebase
  → agent assesses upstream changes, adapts and commits if necessary
  → verify the resulting candidate as required
  → attempt method-specific integration against the captured target
       target moved → return target_moved → repeat preparation
       applied      → report verified result
       blocked      → report the concrete reason; no blind retry
```

1. `prepare` captures the target's actual local ref, not a guessed main branch, a cached remote-tracking tip or a freshly fetched remote. It inspects the selected source/target and runs only the permitted preparation. Another branch landing changes what "latest" means on the next attempt.
2. A successful rebase returns old/new source IDs, the target used and bounded information for reviewing the rewritten series/upstream delta. This happens even with no conflicts or apparent content changes. It never silently proceeds to tests or merge. An already-prepared no-op is labelled as such, not as a rebase.
3. The agent evaluates semantic compatibility and applicable rules. It can adapt code, make selected commits, run additional checks, or ask a substantive question. The workflow does not infer correctness from exit code zero, resolve semantic conflicts, or demand a new human review checkbox merely to acknowledge agent assessment.
4. A later agent request verifies/integrates the resulting candidate. A rebase or other source change invalidates old candidate approvals and verification. Target, recipe and relevant policy changes invalidate their affected evidence too. A reported successful check is not itself merge permission. No fabricated no-op check is used to satisfy an engine's nonempty-list requirement.
5. Immediately before integration, acquire short operation-scoped reservations and revalidate both exact refs, identities, policy and required evidence. For the serial policy, the prepared feature must incorporate the captured current target as its base; do not merge target into feature as a substitute for the configured rebase strategy. FF is **ff-only**; non-FF creates the explicitly requested two-parent integration commit. Unsupported feature-history topologies block rather than silently changing history semantics.
6. Concurrent managed attempts against the same repository/target cannot both apply a stale plan. The loser gets `target_moved` with fresh facts and returns to the agent. Saved rebase permission can cover the next attempt; Ask mode asks according to its own scope. Do not hold target locks across coding, human review or long check runs. Return to the agent without implicit retries. The controller bounds proven target-movement attempts to three per current user request; native/public diagnostic projection remains conservative when precise movement proof is unavailable.

The implemented dependent verify/integrate invocation must be constructed **after the rebase result reaches the agent**, in a later assistant tool turn. Require an unpredictable result-issued revision token or equivalent result dependency; merely receiving another call is insufficient because a prequeued/batched prepare → verify → integrate sequence could skip agent assessment. This is operation-level dependency evidence, not task adoption or a human acknowledgement. It cannot prove that the agent reasoned correctly. No human semantic-approval gate is added unless selected by policy or required by project rules. Unconsumed dependencies expire strictly within five minutes of actual completion. Already-prepared no-ops issue/refresh none; at most three explicit independently proved reconciliations per live scope can renew ordering with zero receipts. Restart and historical artifacts can only deny old ordering authority, not restore it.

Rebase is separately authorized history rewriting. **Private-history policy clarification (2026-10-01):** the user chooses to *assume* every branch other than the project's explicitly designated main branch is private; lack of a Pi Web creation record alone does not block preparation. This is a policy assumption, not proof that no external copy exists. Never rewrite the designated main branch, and fail closed when the designation cannot be established. Positive local evidence of shared/published commits, stricter project/user instructions, unsupported topology, conflicts or dirty state still blocks native rebase or requires a separately permitted manual path; do not fetch to guess what a remote contains. A saved Allow remains separately scoped authorization, not evidence of history privacy. Preserve original work and report whether a failed owned preparation restored it or left a known partial state. Never abort another writer's Git operation, stash/reset user edits, force-push, or quietly drop commits to obtain a clean result. Conflict/adaptation decisions belong to the agent and user under their project rules, not a new workflow-specific code-reasoning engine.

There is no perpetual merge queue or background retry job in this contract. Reconnect or server restart cannot resume rebase/integration without a fresh agent invocation and state reconciliation.

## 6. One simpler Workflow panel

Keep one Workflow home and the independent read-only Git Explorer. The Workflow home answers **"How does this project use Git?"** and **"What did the tools do?"**, not "Which task owns this session?"

- A visible project selector defaults to the chat's project but can configure another allowed project without moving the chat. The selected settings project never silently retargets an action.
- Global / Project / This chat for this project reuse one editor. Show field origin and reset, named main branch, direct/worktree strategy, delivery, preparation, verification, merge method, confirmations and cleanup. Keep detailed recipes and backend diagnostics expandable.
- Display clear summaries such as **Commits: allowed, no confirmation**, **Preparation: rebase, no confirmation**, **Delivery: PR handoff, local merge disabled**, rather than overlapping Off/Manual/Ask/Automatic labels whose meaning changes by row.
- No required Current task adoption block, goal/request picker, source-text review or Move/Fork step before normal tools can work. Retire the existing metadata prerequisite from the primary path without deleting its records or converting them to authority. Optional move/fork stays under workspace utilities.
- Missing choices can open the same editor with the relevant project/scope highlighted. Existing complete policy yields a concise nonblocking summary, not another questionnaire. Ordinary Save changes settings, never starts an operation. Save with broader execution permission describes exactly what is being allowed.
- **Never require an idle-only settings edit while holding the chat in a blocking question.** Missing operation input is not the same as denied permission: for an otherwise eligible worktree request with no saved base, the agent can propose the explicit local base and full expected tip in one native creation approval, without Save → Apply → resume. Existing configured choices must not be silently overridden, and pause, disabled/read-only/subagent restrictions and invalid state remain blockers. An operation proposal does not save defaults or acquire future consent. Retain idle protection for persistent chat/task edits; any remaining setup blocker must give a usable stop/edit/resume path rather than asking the user to confirm an impossible action.
- Chat history can contain actions from several repositories. Every card identifies its project/workspace, method, authorization basis and actual result. Preserve drafts and focus when a request arrives; a pending action keeps its captured identity even while another project is selected in the editor.

The earlier prototype illustrates historical UI decisions; it is not the replacement layout or an implementation specification for mandatory task controls. This revision does not require a new visual prototype before establishing these semantics.

## 7. Safety belongs to operations, not session ownership

Reuse exact candidate capture, index locks, operation-marker checks, conditional ref updates, live capability validation, private journaling and explicit recovery outcomes. Reserve the resources needed by an operation for its critical section; do not introduce an exclusive session-to-worktree relationship as a prerequisite for ordinary commits or preparation.

Concurrent writers still matter. Dirty/staged state, active conflicting Git operations and known processes using affected resources must not be ignored just because no session owns the checkout. Admission must cover the operation's relevant aliases and known writers. Persist verification process/resource identity and reconcile surviving children after crash, restart or cancellation without trusting recycled PIDs. Until their state is safely reconciled, affected checkouts are quarantined from conflicting commits, rebases, integration and deletion—not merely from cleanup. "No replay" alone does not prevent an old check from continuing to write. External writers remain outside complete control; describe that limitation rather than promising a filesystem sandbox or global atomicity. The implemented Linux native boundaries retain the original immutable authority revision through owned progress and require synchronous live postguards after awaited callbacks, with no yield before effects. Preparation verifies physical tracked blob bytes and modes through pinned descriptors, not cached-stat cleanliness. Unsupported descriptors/containment/authority providers and bounded-content excess fail closed.

Cleanup remains stricter: separate permission, exact named branch/worktree, proven safe history disposition, unchanged clean state, known inactive use and explicit handling of ignored files. Creation provenance helps identify resources; it does not establish exclusive ownership or make all ignored files disposable. A chat actually located in a worktree, even an idle persisted chat, is a cleanup blocker requiring a separate explicit relocation decision, never automatic movement. Production uses `readTerminalWorkspaceUsage`; unknown terminal inventory denies rather than assuming a quiet fixture. Unknown inventory, surviving check processes or partial outcomes retain the resources. Never remove primary/target checkouts under feature-cleanup permission. **Cleanup disposition decision (2026-10-01):** the separately authorized, exact eligible cleanup candidate may remove both the selected feature worktree and its local feature branch after proving safe integration. This does not authorize deleting a branch merely because its checkout vanished: record each effect, retain/quarantine partial deletion for inspection and do not force-remove, retry or infer remote publication. Worktree-only legacy removal stays a separate manual operation; this decision does not approve cleanup of any current feature worktree.

Persist candidate evidence and mutation intent before apply, actual outcomes afterward, and distinguish prepared IDs from successful mutations. Do not replay approvals/jobs from history, duplicate an uncertain operation, or retry a partial mutation automatically. Historical cards remain readable independently of live authority and workspace existence. The public read-only `artifact` operation reconciles bounded actual persisted full history and trusted leaf ancestry through a Linux descriptor-pinned reader. Chunked prefixes/suffixes are labelled incomplete and cannot mint mutation authority.

Use native supported backends first. An optional versioned adapter must implement the same scope, permission, journal and recovery contract; raw CLI calls are not an alternate permission system. Unsupported hooks/signing/filters/attributes, unsafe history or failed access checks are not fallback permission. Oversized candidates need truthful bounded/per-file presentation or an explicit actionable limit, never silent truncation or a generic retry loop.

## 8. Implementation and instruction alignment

The [successor plan](../plans/2026-09-29_policy-driven-git-tools-plan.md) owns the implementation sequence and verification ledger. Its bounded resource/policy, commit, workspace/check/rebase, FF/non-FF integration and deletion-safe cleanup source is now connected; it does not add a prerequisite wizard or replace the existing durable cards/native engines. Historical slice evidence remains intact. Deployment, live permissions and instruction alignment are separate work, not implied completion steps.

The current always-ask instructions in Pi Web and `~/nix/my_nix_os` cannot remain contradictory to saved preauthorization. A separately authorized instruction change must say: use available managed tools; apply the selected project's rules; do not repeat a decision covered by supported user-created authorization; ask for missing permission or exceptions; never use shell fallback after a denial. Other harnesses without those capabilities retain the conservative lifecycle. No bulk repository-rule rewrite or Nix activation is authorized by this document.

## Acceptance examples

| Scenario | Required result |
| --- | --- |
| Render a LaTeX example or answer an ordinary question | No Git status/setup/approval call merely because workflow guidance is present |
| Worktree-mode chat has no base and the user requests a code change | An explicit base/tip can be approved for that creation without a blocking request to edit idle-only settings; saved restrictions remain intact |
| Existing chat contains old app-injected workflow reminders | Old reminders do not reinstate unconditional Git tasks; raw transcript history stays intact |
| One chat, two worktrees of A and one checkout of B | Correct per-operation source and per-project policy; no chat moves, adoption ceremony, leaked defaults or lost action history |
| Small project, direct main, commit confirmation off | Explicit selected commit without a human prompt or fictitious integration stage |
| Operator wants tighter control | Enable commit/rebase/merge confirmations independently; exact candidate still presented when required |
| Partial staging | Commit only deliberately selected staged content; retain unrelated index content and unstaged hunks |
| Two features race to land | First integration succeeds; the other returns target movement, repeats permitted preparation, then yields to the agent before fresh verification/integration |
| Clean rebase changes upstream semantics | Agent receives the outcome and assesses/adapts; no hidden prepare-and-merge continuation |
| FF-only versus non-FF | Exact requested history form, no automatic method substitution |
| PR or leave-branch project with permissive Global merge settings | Local integration refused; no inferred remote publication |
| Empty workflow recipes | No invented check; project-required verification remains the agent's responsibility |
| Revocation, changed policy, stale candidate or unknown outcome | Block/cancel at safe boundaries, invalidate affected evidence, preserve actual results and never replay |
| Busy/dirty/unmerged/unknown cleanup resource | Retain it with a concrete reason, without requiring unrelated sessions to relocate |

Success is measured by fewer routine setup/approval prompts and fewer agent-generated plumbing commands for these cases, while selected changes, project rules, exact execution state and truthful results remain under control.
