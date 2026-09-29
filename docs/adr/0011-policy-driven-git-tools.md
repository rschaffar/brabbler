# 0011 — Project policies and agent-driven Git operations

## Status and reading guide

**Accepted product direction, 2026-09-29; documentation revision only.** The user clarified the intended experience after using the integrated Workflow panel and requested a design update before further implementation. This record supersedes the incompatible future direction in [ADR 0010](0010-integrated-git-workflow.md), especially mandatory task/workspace binding, session handoff, and host-driven start/finish orchestration. It also revises the eventual same-repository limitation of [ADR 0009](0009-cross-worktree-agent-git-tools.md). These are target capabilities, not changes to installed behavior or active permissions.

Start with **The intended experience** below. [Git workflow](../git-workflow.md) describes what is implemented today. The [policy-driven Git tools plan](../plans/2026-09-29_policy-driven-git-tools-plan.md) is the sole active implementation roadmap; the previous plan retains historical evidence.

This decision does not authorize implementation, change saved permissions, relax repository instructions, or authorize integration, cleanup, remote operations or deployment. The current global Git lifecycle and repository safeguards still apply to work on this design.

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

Use a small typed surface, retaining `git_workflow` for policy/status and bounded Git mechanics and `git_commit` for the frequent commit operation. The exact schema is implementation work, but the operation families are:

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

The agent determines staging, commit boundaries and messages. Support deliberately selected whole-file changes and an explicit staged-candidate path for partial/hunk staging. Never hide `git add .`, commit every dirty path on "finish", unstage unrelated work, or overwrite an index to make the request succeed. An explicit staged mode must name/validate its selected index content, preserve unstaged hunks and unrelated staged changes, and reject mismatches. If a backend cannot preserve those semantics, report the unsupported mode before changing anything. Whole-file selection must not silently widen a partial staged selection.

Current `lib/git-commit.ts` only supports whole files with an initially clean index. That is a reusable primitive, **not** evidence that the staged path exists. The agent may continue making deliberate staging choices through ordinary Git where permitted, but an unsupported/denied tool action must not invite a consent-bypassing shell fallback.

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
6. Concurrent managed attempts against the same repository/target cannot both apply a stale plan. The loser gets `target_moved` with fresh facts and returns to the agent. Saved rebase permission can cover the next attempt; Ask mode asks according to its own scope. Do not hold target locks across coding, human review or long check runs. Use bounded retries/backoff and report repeated contention rather than spin forever.

The dependent verify/integrate invocation must be constructed **after the rebase result reaches the agent**. Require an unpredictable result-issued revision token or equivalent result dependency; merely receiving another call is insufficient because a prequeued/batched prepare → verify → integrate sequence could skip agent assessment. This is operation-level dependency evidence, not task adoption or a human acknowledgement. It cannot prove that the agent reasoned correctly. No human semantic-approval gate is added unless selected by policy or required by project rules.

Rebase is separately authorized history rewriting. A branch's mere existence in a worktree does not prove that it is private or safe to rewrite. Known shared/published history, uncertain rewrite eligibility, conflicts, dirty state and unsupported topology produce a specific blocker or a permitted manual path. Preserve original work and report whether a failed owned preparation restored it or left a known partial state. Never abort another writer's Git operation, stash/reset user edits, force-push, or quietly drop commits to obtain a clean result. Conflict/adaptation decisions belong to the agent and user under their project rules, not a new workflow-specific code-reasoning engine.

There is no perpetual merge queue or background retry job in this contract. Reconnect or server restart cannot resume rebase/integration without a fresh agent invocation and state reconciliation.

## 6. One simpler Workflow panel

Keep one Workflow home and the independent read-only Git Explorer. The Workflow home answers **"How does this project use Git?"** and **"What did the tools do?"**, not "Which task owns this session?"

- A visible project selector defaults to the chat's project but can configure another allowed project without moving the chat. The selected settings project never silently retargets an action.
- Global / Project / This chat for this project reuse one editor. Show field origin and reset, named main branch, direct/worktree strategy, delivery, preparation, verification, merge method, confirmations and cleanup. Keep detailed recipes and backend diagnostics expandable.
- Display clear summaries such as **Commits: allowed, no confirmation**, **Preparation: rebase, no confirmation**, **Delivery: PR handoff, local merge disabled**, rather than overlapping Off/Manual/Ask/Automatic labels whose meaning changes by row.
- No required Current task adoption block, goal/request picker, source-text review or Move/Fork step before normal tools can work. Retire the existing metadata prerequisite from the primary path without deleting its records or converting them to authority. Optional move/fork stays under workspace utilities.
- Missing choices can open the same editor with the relevant project/scope highlighted. Existing complete policy yields a concise nonblocking summary, not another questionnaire. Ordinary Save changes settings, never starts an operation. Save with broader execution permission describes exactly what is being allowed.
- Chat history can contain actions from several repositories. Every card identifies its project/workspace, method, authorization basis and actual result. Preserve drafts and focus when a request arrives; a pending action keeps its captured identity even while another project is selected in the editor.

The earlier prototype illustrates historical UI decisions; it is not the replacement layout or an implementation specification for mandatory task controls. This revision does not require a new visual prototype before establishing these semantics.

## 7. Safety belongs to operations, not session ownership

Reuse exact candidate capture, index locks, operation-marker checks, conditional ref updates, live capability validation, private journaling and explicit recovery outcomes. Reserve the resources needed by an operation for its critical section; do not introduce an exclusive session-to-worktree relationship as a prerequisite for ordinary commits or preparation.

Concurrent writers still matter. Dirty/staged state, active conflicting Git operations and known processes using affected resources must not be ignored just because no session owns the checkout. Admission must cover the operation's relevant aliases and known writers. Persist verification process/resource identity and reconcile surviving children after crash, restart or cancellation without trusting recycled PIDs. Until their state is safely reconciled, affected checkouts are quarantined from conflicting commits, rebases, integration and deletion—not merely from cleanup. "No replay" alone does not prevent an old check from continuing to write. External writers remain outside complete control; describe that limitation rather than promising a filesystem sandbox or global atomicity.

Cleanup remains stricter: separate permission, exact named branch/worktree, proven safe history disposition, unchanged clean state, known inactive use and explicit handling of ignored files. Creation provenance helps identify resources; it does not establish exclusive ownership or make all ignored files disposable. A chat actually located in a worktree is a cleanup blocker requiring an explicit relocation decision, not a reason to move every chat into worktrees at creation. Unknown inventory, surviving check processes or partial outcomes retain the resources. Never remove primary/target checkouts under feature-cleanup permission.

Persist candidate evidence and mutation intent before apply, actual outcomes afterward, and distinguish prepared IDs from successful mutations. Do not replay approvals/jobs from history, duplicate an uncertain operation, or retry a partial mutation automatically. Historical cards remain readable independently of live authority and workspace existence.

Use native supported backends first. An optional versioned adapter must implement the same scope, permission, journal and recovery contract; raw CLI calls are not an alternate permission system. Unsupported hooks/signing/filters/attributes, unsafe history or failed access checks are not fallback permission. Oversized candidates need truthful bounded/per-file presentation or an explicit actionable limit, never silent truncation or a generic retry loop.

## 8. Implementation and instruction alignment

The [successor plan](../plans/2026-09-29_policy-driven-git-tools-plan.md) sequences small vertical slices: resource/policy selection and commits; independent workspace/check/rebase operations; moving-target FF/non-FF integration; then deletion-safe cleanup. Each slice must show actual token/question savings without adding a prerequisite wizard. Existing durable cards and safe Git engines are reused, not rewritten wholesale.

The current always-ask instructions in Pi Web and `~/nix/my_nix_os` cannot remain contradictory to saved preauthorization. A separately authorized instruction change must say: use available managed tools; apply the selected project's rules; do not repeat a decision covered by supported user-created authorization; ask for missing permission or exceptions; never use shell fallback after a denial. Other harnesses without those capabilities retain the conservative lifecycle. No bulk repository-rule rewrite or Nix activation is authorized by this document.

## Acceptance examples

| Scenario | Required result |
| --- | --- |
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
