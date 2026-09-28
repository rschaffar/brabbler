# 0010 — An integrated, permission-aware Git workflow

## Status

**Accepted direction — staged implementation in progress.** After reviewing the single-Workflow-home design and prototype, the user said “alright. give it a shot,” authorizing Pi Web application implementation in the existing linked worktree. The target remains operation-first behavior, configurable end-to-end automation, and Global/Project/Session configuration in **one place**. This is source-implementation authority, not a runtime grant or approval for integration, publication, cleanup, Nix source changes, or activation.

This revises ADR [0007](0007-session-git-workflow.md)'s eventual session-snapshot and integration-consent model, ADR [0008](0008-agent-triggered-git-review.md)'s split settings/transient presentation, and the tool surface described in ADR [0009](0009-cross-worktree-agent-git-tools.md). Exact-state validation, explicit checkout identity, scoped authority, recovery, and the remote boundary remain. Unimplemented parts are a target contract, not advertised capabilities. Existing repository/global approval rules remain operative until compatible instruction changes are separately accepted.

The first application slice implements the shared scoped editor/resolver, captured session task choices, explicit adoption, live enablement/pause gates, and a common human-approved commit path. It does **not** introduce standing grants, automatic integration/cleanup, durable action cards, per-task workspace ownership, or an instruction-policy adapter. Existing legacy agent-commit snapshots remain supported; new managed tasks offer Off/Manual/Ask, not unsupported Automatic execution. See the plan and current guide for the implemented boundary.

Implementation owner: [Integrated Git workflow plan](../plans/2026-09-28_integrated-git-workflow-plan.md).

## Problem and evidence

The desired product is **one workflow with defaults and visible results**, not a questionnaire wrapped around several Git commands. A user should answer related setup choices together, save them at the appropriate scope, and see what happened after the agent acts. The transport should not determine the permission model.

Current source explains the fragmentation:

- `lib/git-workflow-policy.ts` and `lib/agent-git-preferences.ts` store independent policies. Choosing worktree intent in the preference card does not satisfy `git_workspace_start`'s saved-policy requirement.
- `lib/git-workflow-store.ts` has project defaults but no global layer. Opting out of a session policy does not disable the independent agent workflow tool or its generic guidance.
- `lib/git-commit-extension.ts` commits under saved consent; `lib/agent-git-workflow-extension.ts` always asks for a commit approval. The same user intent behaves differently depending on tool selection.
- `components/GitActionDialog.tsx` and `hooks/useAgentSession.ts` implement transient requests, not durable action history. Closing an approval is not evidence that the subsequent mutation succeeded.
- A chat's cwd, the feature checkout used by shell commands, and the Explorer's selected checkout can be different. `workspaceBranch` helps, but the agent must keep remembering the distinction.
- The inspected global `git-worktrees` skill prefers `git workflow` CLI mechanics and explicitly requires repeated questions. Merely telling the model to prefer native tools cannot reconcile that lifecycle.

The read-only September 28 investigation examined local Pi Web session JSONL records and these source modules. Session `01a0e357-436…` exercised native review but encountered checkout and combined trust/busy refusals; the referenced session `01a0e757-2975-7695-b6d7-3bb9ebe8b91d` requested post-commit/decision cards, side-by-side diffs, layered defaults, and persistence outside model context. These are concrete examples, not an adoption-rate measurement or proof of every historical runtime blocker.

**Retraction of the earlier recommendation:** retaining the CLI as the ordinary lifecycle and adding native cards only where convenient would preserve two competing systems. A hybrid implementation is acceptable; a fragmented user workflow is not. Likewise, “use preferences only when helpful” means do not interrupt an already-configured task—not keep setup disconnected from execution.

## Product model

Separate five concepts in the implementation, but present them coherently:

| Concept | Meaning |
| --- | --- |
| Definition | How this project works: checkout strategy, base/target, methods, checks, environment, naming, signing/hooks, constraints. |
| Preference | What the user normally wants: continue/fork/stay, automation level, retention, display. |
| Authorization | A one-time decision or explicit, revocable standing grant for a named class of action within a scope. |
| Workflow | One bounded coding task, with concrete repository/workspace bindings and a captured configuration revision. |
| Action | One proposal, check run, commit, integration, transition, or cleanup, with durable evidence and an outcome. |

A session may contain several sequential workflows. A workflow may survive an explicitly managed session move/fork. Neither “one automatic worktree per chat” nor “chat cwd is always the feature checkout” is a useful permanent abstraction.

**Defaults answer what; grants answer whether; exact-state checks answer whether it is still safe now.** A default target is never a grant to merge into it. Selecting Automatic and explicitly saving its described authority can create such a grant.

## 1. Configuration and control at three scopes

### One hierarchy, one resolver

Use **Global defaults → Project overrides → Session overrides**, resolved field by field. Missing means inherit; explicit `off`, `none`, and an empty list mean exactly those values. Reset removes the override. Ordered check lists replace the inherited list unless an explicit include/extend operation is selected; do not concatenate commands invisibly.

The same resolver serves the single Workflow editor, setup requests, agent guidance, manual actions, and tools. It returns requested values, effective values, per-field provenance, restrictions, backend capabilities, missing choices, and the configuration revision. No second preference namespace with competing values.

Global/project data remain private Pi Web settings, keyed by canonical repository identity so linked worktrees share a project. Session overrides use versioned non-context metadata. Do not place consent in repository-controlled files or overwrite Pi's unrelated `settings.json` fields. Schema names are implementation choices, not a new Pi SDK settings contract.

Suggested settings groups:

| Group | Choices |
| --- | --- |
| Integrated workflow | Enabled/disabled; stages individually enabled/disabled. |
| Workspace | Current checkout, new branch in current checkout, dedicated worktree, or explicitly selected existing feature; base selector; naming/location; continue/fork/stay. |
| Verification | Ordered recipes, required/conditional checks, cwd/environment, timeouts, execution permission. |
| Commits | Manual, ask each time, or automatic under a grant; selected-file scope and identity/hook/signing requirements. |
| Preparation/integration | Leave feature, prepare a handoff, or local integration; target and method; rewrite policy; ask/automatic authority. |
| Cleanup | Retain, ask, or automatic eligible cleanup; branch/worktree disposition; generated-artifact policy; chat destination. |
| Presentation | Compact/full result cards, default split/unified diff, notification preference. |

Only supported combinations are executable. For example, selecting current-checkout work must not create a fictitious merge into the same branch; disabling workspaces need not disable commits or history.

The fresh-install preset is **Assisted**: resolve workspace/check definitions from the project, ask for missing choices and new execution grants, ask for commits/integration, retain resources, and show compact result cards with split diffs. Existing explicit agent-commit consent is preserved during migration. The user's **Automatic local workflow** preset changes only the stages they explicitly authorize; it is not silently enabled for every project. Show the preset and a short stage summary first, with individual controls under Customize.

### Enablement is not consent

Each capability has availability plus its relevant mode: **Manual / Ask / Automatic** for mutations, **Retain / Ask / Automatic** for cleanup. **Off** disables that managed action for both tools and the sidecar; **Manual** allows a human-initiated sidecar action with exact confirmation but not agent execution; **Ask** allows the agent to request that confirmation; **Automatic** allows scoped granted execution. Presets such as Off, Review-only, Assisted, and Automatic local workflow are editable bundles, not additional policy layers. Safe initial defaults do not enable unattended destructive actions.

Disabling integrated Git removes its agent mutation tools/guidance and blocks their server-side dispatch, including calls from already-loaded wrappers. All integrated UI routes use the same gate. Git Explorer and historical records remain independently readable. Optional presentation suppression does not delete the transaction journal needed for safety.

A Git-tools switch is **not a sandbox** for unrestricted bash, external terminals, or other applications. Say so in the UI. Do not promise that it prevents all Git mutations.

### When settings take effect

For newly adopted v2 sessions, resolve inherited values when beginning each workflow, then snapshot that bounded task. Default changes do not silently retarget an active workflow or increase its authority. Show “Defaults changed — compare/apply to this task” when appropriate. Session overrides remain explicit and survive panel closure and reload.

Only choices are pinned: live safety restrictions are not. Before affected actions, compare the reviewed project-rule sources and current restrictions. New required checks, target protection, mandatory human review, or unknown rule changes invalidate affected plans/receipts and pause unattended execution for reconciliation. Loosening a rule does not broaden an active grant automatically.

Effective disablement and grant revocation apply to pending/future actions immediately, including queued work and unanswered approvals; stop cancellable checks. Do not interrupt a ref/index update halfway through merely to implement a toggle: finish its safe boundary, record the result, and block the next action. Increasing permissions on an active task requires explicit adoption.

A lower-level explicit enabled override can supersede an inherited default-off; the UI must show that, rather than pretend changing the global default stopped every session. Provide a distinct **Pause all managed Git actions** safety control that cannot be overridden by session defaults. Pause is not another inheritance layer.

Old session snapshots remain pinned until explicit migration/adoption; no retrospective permission widening. Forks retain safe preferences but do not inherit live action approvals or executable jobs.

## 2. One setup experience, not a maze

Before the first task mutation, inspect Git state and applicable project rules. If effective choices and grants are complete, show a compact nonblocking “Using this workflow” card and proceed. A read-only investigation does not start a Git workflow merely because tools exist.

Otherwise show one durable **setup request** in chat, such as “Two workflow choices needed — Configure workflow.” It opens the **same Workflow panel and row editor**, with the missing choices highlighted and relevant details expanded. Do not build a second chat settings form or a separate setup wizard. All related choices can be answered together; the request and eventual result remain visible in chat.

For a pending request the panel clearly says “Complete setup for this task.” Its footer offers **Use once for this task** and an explicitly scoped **Save [scope] & continue**, instead of silently converting one-time answers into defaults. The same Global/Project/Session control chooses where reusable values would be saved. Task-specific branch/path inputs belong to the requested operation and are never copied into defaults; a task is not a fourth inheritance tab. Ordinary browsing/editing uses Save only and starts nothing.

Ordinary choices and explicitly described permission grants can be selected in the same form. Changing a target or ticking a check does not silently grant execution; Automatic controls name their effects and scope, and the save/start button explicitly confirms those grants. Never precheck a new automatic integration/cleanup grant during migration.

Session settings apply to later tasks in this chat; Project and Global persist reusable overrides. The footer's review summary separates (1) project-definition adoption, always project-scoped; (2) changed preferences and their destination; and (3) each expressly selected grant and its scope. A one-time answer changes no later task's defaults. Do not copy a concrete feature branch, temporary path, or this project's branch names into global defaults as an accidental form-save side effect. Suggested values and unchanged inherited fields are not silently written as overrides.

Only missing, contradictory, unsupported, or newly broadened decisions require interruption. Read-only review does not require an “I reviewed it” click to unblock the agent. In Ask mode, later exact-candidate approval is necessary; the setup card must say so, rather than pretending the initial choice approves unknown changes.

## 3. One Workflow home: status and all three configuration scopes

**Explicit design correction:** the earlier proposal of a Workflow sidecar plus `Settings → Git workflow` is withdrawn at the user's request. Sharing an editor component in two locations would still be two places. Workflow is the sole configuration destination; no separate Git preferences form in general Settings, no settings modal behind the panel, and no independent setup form in chat.

Consolidate the current Workspace, Commit, and Integration entry points into one clearly labelled **Workflow** button. Keep **Git Explorer** independent and read-only; it is a browser, not another settings destination. Workflow remains accessible when disabled and without a selected chat so users can actually enable/configure it.

### Resting layout

```text
Workflow                                      Pause all
pi-web / Improve session search

CURRENT TASK
feat/session-search → rst-main                 Working
Workspace ready · 1 commit · Checks next
Using captured task settings · Details

Configure workflow                            1 override
[ Global ] [ Project · pi-web ] [ Session ]
Only this chat · future tasks                      Saved

Integrated Git workflow                              On
From Global
───────────────────────────────────────────────────────
Workspace                                  Automatic  ›
Dedicated worktree · continue this chat       From Global
───────────────────────────────────────────────────────
Commits                                    Automatic  ›
Complete selected files                      From Global
───────────────────────────────────────────────────────
Checks                                     Automatic  ›
Unit tests · Types · Lint                 From Project
───────────────────────────────────────────────────────
Integration                                   Ask me  ›
rst-main · non-FF merge                          Set here
───────────────────────────────────────────────────────
Cleanup                                       Retain  ›
Feature worktree and local branch             From Global

Recent task activity
✓ Commit created · a31d92c                         14:29
✓ Feature workspace ready                         14:24

[Footer appears only while editing]
2 session changes       Discard   Save session settings
```

These are illustrative choices, not a change to anyone's real settings. The current-task block answers “What is happening?”; the scope selector and five stage rows answer “How should it work?” Do not mix those two kinds of state.

### Scope selector: one editor, not three separate forms

Use a compact three-segment **Global / Project / Session** control above the same rows. Default to Session for a selected chat, Project for a selected project without a chat, and Global otherwise. There is no giant three-column matrix of duplicated controls. Scope names remain visible, with override counts and unsaved markers where helpful.

- **Global:** personal defaults for projects. Project-specific targets/commands say “Use project definition,” not a misleading copied `rst-main` or `npm test`.
- **Project:** reusable overrides for the canonical repository, shared by its worktrees. Show its actual name next to Project.
- **Session:** exceptions for this chat and its later tasks. A fresh composer can show “Next chat”; a missing chat must never be silently created just to edit defaults.

Each row shows the value resolved **at the selected scope**, plus `From Global`, `From Project`, or `Set here`. Editing Global must not show a session override as if it were the global default. If a downstream override means a change will not affect this chat, show that consequence in the expanded row/save summary.

Expanding a row reveals a compact inheritance trace, for example **Global: Ask → Project: Automatic → Session: Ask**. The mode menu includes **Use inherited value (Automatic)**; choosing another value creates only that field's override. Reset is labelled **Use Project value**, **Use Global value**, or **Restore built-in default**, never the ambiguous “Clear policy.” Explicit Off is not inheritance. The master enablement control also exposes its source and a reset-to-inherit action.

Repository constraints are a different visual concept from inherited preferences: `Required by AGENTS.md` with a readable explanation, not a badge suggesting it is an editable project default. Display requested versus allowed behavior when they differ. One project's restriction does not lock a global default for every other project; show its local effect instead.

### Five readable rows, progressive detail

Each stage has a readable label, a one-line summary, its permission/value, source, and disclosure. Expand one row at a time by default while retaining drafts elsewhere. Simple changes should need only opening the row and choosing a value.

- **Workspace:** strategy/base, naming if relevant, and continue/fork/stay. Actual Move/Fork actions belong to the current task's workspace detail, not a large form before configuration.
- **Commits:** Off/Manual/Ask/Automatic, scope and requirements. Review changed files opens a focused action view in this same panel.
- **Checks:** ordered check names first; expand a recipe to edit executable/argv, directory, environment, and timeout. No permanent stack of empty command forms; no implied shell parsing.
- **Integration:** target, supported method, private-history preparation, and permission. Unsupported actions explain why; they do not look executable.
- **Cleanup:** Retain/Ask/Automatic, resource disposition, chat destination and advanced artifact policy. Do not imply that “ignored” means deletable.

Presets are a convenience in this editor, not another setup screen or automatic permission grant. Presentation options such as split/unified diff and compact cards stay in a small **Display & notifications** disclosure inside Workflow. Unusual backend/capability and identity details stay under their relevant stage, not a new global settings destination.

### Saving, current tasks, and pending requests

Scope selection determines the save destination. A sticky footer names it: **Save global defaults**, **Save project defaults**, or **Save session settings**. Ordinary changes are staged and saved together for that scope, not persisted on every keystroke. New automatic authority adds a visible, specific grant summary and an explicit Save-and-allow label; it is not hidden behind a generic Save button.

Preserve drafts keyed by scope and project/session identity across expansion, scope navigation, panel closure, and focused reviews. Mark scopes with unsaved changes. Save affects **only the selected scope**; no silent multi-scope save or modal question whenever the user changes scope. Unsaved parent drafts do not masquerade as saved inherited values in another scope. Switching the open chat/project never rebinds a draft to a different identity. Revision conflicts are handled inline; do not overwrite another client's changes.

Defaults editing does not change the current-task block while navigating scopes. After a relevant save, show **“Defaults differ from this task — Compare”** with a separate **Apply to this task** action. Stricter rules, effective disablement, revocation, and the pause-all control retain their live safety semantics. `Global default: Off` explicitly says when project/session overrides remain enabled; **Pause all** is the distinct unconditional managed-action pause, not a second default switch.

Pending setup reuses these rows and the scoped footer as described in section 2. A newly arriving request updates the task's attention state and its durable chat card; it must not close the panel, discard a draft, steal typing focus, or replace a Save button with Approve. Exact review uses a **Back to Workflow** detail view with captured files/diff and the same action ID as its chat card. These are projections of one decision, not independently authorized flows. Chat retains outcome/decision cards, but never another configuration editor.

### Visual direction and responsive behavior

The redesign is about hierarchy and interaction, not decorative colors:

- Use the app's existing theme tokens and system sans. Approximately 18–20px panel title, 14px row labels/body, and 12–13px supporting text; monospace only for paths, commands, and IDs. Use `--accent-contrast`, not hardcoded white on the pale dark-theme accent.
- Aim for a resizable 480–560px desktop panel, rather than shrinking a dense form into the current 370px Activity container. Review can widen the same panel for a split diff. At constrained widths, use a full-width layer rather than squeeze controls beside chat.
- Use 20–24px desktop gutters, 16–18px mobile gutters, roughly 64–80px collapsed rows, subtle separators, and one calm task surface. Avoid nested bordered fieldsets, heavy shadows, gradients, and repeated blocks of warnings.
- Use accent for selection and the primary action, not every label. Ask/Manual are normal modes, not amber warnings. Reserve warning/error treatment for an actual decision, constraint, failure, or recovery state; color is never the only status cue.
- Prefer short project/branch names; reveal full copyable paths and OIDs in details. If chat and feature locations differ, say so immediately rather than hiding the mismatch in a tooltip.
- On mobile, the same Workflow home fills the viewport with Back to chat, the three scope segments, stacked rows, 44px touch targets, 16px inputs, preserved scroll/drafts, and a safe-area-aware sticky footer. Horizontal scrolling belongs only inside diffs/commands, never the whole panel.
- Use labelled native controls, keyboard-operable scope selection/disclosures, visible focus, text status, inline error associations, and polite announcements. In a covering mobile layer, handle focus containment/restoration. No hover-only explanations or unsolicited focus changes.

Without a chat, show a compact no-active-task state and leave Global/Project editing usable. With no selected repository, Global remains usable and Project offers a selector in this same home. A non-Git project explains the missing capability without trapping the user outside settings. Choosing a project for configuration never moves the active chat or silently changes an action's checkout.

### Visual prototype

The [standalone prototype](../plans/assets/integrated-git-workflow.html) demonstrates scope switching, stage expansion, inherited values/reset, per-scope drafts, and scope-labelled save feedback using synthetic data only. It makes no API calls, performs no Git operations, and stores nothing outside page memory. Its static task/receipt are illustrations, not real state; full recipe editing, no-chat selection, actual approvals/diffs, focus restoration, and the backend are not implemented in this artifact.

[Desktop study](../plans/assets/integrated-git-workflow-desktop.png) · [Mobile inheritance study](../plans/assets/integrated-git-workflow-mobile.png). The pictures establish the visual direction, not a claim that application behavior has shipped.

## 4. Reconsider the agent tool surface

Recommend **one coordinator and one frequent primitive**, not three tools with different permission semantics:

| Tool | Proposed responsibility |
| --- | --- |
| `git_workflow` | Typed `status`, `setup`, `start`, `verify`, `review`, `finish`, and explicit `cleanup` actions on a workflow ID. `finish` orchestrates permitted preparation, verification, integration and disposition, pausing only where needed. |
| `git_commit` | Commit exact selected paths with a message in the bound workspace. The common policy decides automatic, approval-required, or denied; internal preview/revalidation is not a second model-facing consent system. |

Use discriminated argument schemas rather than one bag of mutually incompatible optional fields. `status` reports effective policy, provenance, concrete workspaces, capabilities, active action, and specific blockers. `setup` is available without pre-existing saved policy and writes through the same configuration/consent controller. `start` resolves missing setup rather than dead-ending with “saved worktree policy required.”

Deprecate `git_workspace_start` and the overlapping `git_workflow commit` operation as compatibility aliases into those same controllers. Do not keep independent policy checks. Internal engine preview/confirm APIs can remain; the model normally needs only the higher-level action.

The server binds a workflow to registered physical checkouts and exact local refs. A source selector is needed for adoption or an explicit change, not on every call. Changing Explorer selection does not change that binding. The calling session owns authority; another worktree never contributes another chat's permission.

Guidance should be short and factual: workflow ID, effective mode, active source/target, granted stages, remaining required decisions, blockers. Prefer a changed prompt section or compact current-state projection over repeatedly appending the full generic Git guidance to context. The model proposes work, paths, messages, and additional checks; it cannot manufacture grants or mark a Git operation successful.

## 5. A bounded coordinator, not an unbounded autonomous agent

The host owns a finite workflow state machine and durable operation journal. Model tools, manual UI actions, and supported adapters call the same controller. A tool invocation alone does not grant authority.

A task begins from an authorized coding request when the agent calls `start`, not from a file watcher or merely opening a chat. Bind its goal and originating request. Subsequent related turns use that workflow; a distinct deliverable starts a new one, and ambiguous task/ownership changes pause for clarification. Automatic means approval-free execution within granted stages, not permission to invent new tasks.

The agent chooses coherent commit boundaries and explicit paths/messages, then calls `finish` when the requested deliverable is ready. `finish` accepts a clean candidate: it never silently stages or commits all remaining files. If changes remain, return the exact blocker so the agent can make the appropriate `git_commit` call under the existing policy—without another generic “shall I finish?” question. After accepted `finish`, the host progresses through its bounded permitted stages; it is not waiting for the model to repeatedly issue each plumbing command.

The usual sequence is:

1. Resolve and bind the task; inspect cleanliness, registrations, ongoing operations, applicable instructions, and capabilities.
2. Create/adopt the selected workspace under the applicable consent. If continuing/forking, settle the source run, claim a one-shot transition, rebuild the session in the destination, and resume the already-requested task once. Do not require a user “done, continue” message. Do not keep editing the old checkout while movement is pending.
3. Develop and make coherent selected-file commits according to commit policy. Automatic commits still preview and revalidate internally and always produce an outcome.
4. On `finish`, prepare the explicitly selected target/method, apply permitted private-branch preparation, run authorized required checks against the final candidate, and integrate or retain a handoff as configured.
5. Relocate the owning chat if necessary, then retain or remove eligible resources under independent cleanup authority.

One task can authorize this bounded continuation, including an idle move/fork, without authorizing arbitrary future tasks. An ordinary history fork only inherits read-only records and safe preferences. A **managed task fork** instead transfers exclusive workflow ownership to the destination under a recorded handoff: invalidate the source execution generation before activating the destination, and never leave two owners. Only task authority explicitly covering that handoff follows; session-only grants do not transfer unless the user's grant expressly includes this managed continuation. Otherwise the destination needs the missing consent. A crash during handoff leaves execution paused until one owner can be proven. Browser reconnect never starts execution. A process restart restores history and requires explicit resume/reconciliation, not automatic replay of a partially applied job. Duplicate calls/responses are idempotent by workflow/action ID and revision.

Automatic progression stops on revoked authority, policy conflict, unknown capability, stale assumptions, failed checks, ambiguous history, unexpected files, or partial state. Bounded safe re-planning under a standing grant is possible; a human approval of one candidate never transfers to a different candidate. Avoid indefinite retry loops on a busy target.

## 6. Explicit standing permission, including optional end-to-end automation

The user selected configurable end-to-end automation. Support it intentionally rather than interpreting a remembered preference as blanket permission.

A standing grant records its human origin, scope, revision, enabled action classes, conditions, and revocation. A scope can be one task/session/project or an explicitly chosen global domain such as eligible trusted projects. Repository files and model-authored tool arguments cannot create or widen grants. Broad global automation should be clearly labeled; it does not imply project trust or infer missing branch/check definitions.

All operations still produce exact plans and revalidate immediately before applying. In Ask mode a live response authorizes that plan. In Automatic mode the controller records which valid grant and conditions authorize that exact plan; it must not label it “user reviewed.” The same ref/index/checkout protections apply in both modes.

Minimum conditions by stage:

- **Workspace:** selected local base/ref, permitted path/naming, clean source/base, no collisions; no copying/stashing source edits. Adopting someone else's worktree does not make it workflow-owned.
- **Checks:** named, reviewed recipes with exact executable/argv, cwd/environment, and time/resource limits. Approved recipes execute evolving trusted project code, not a promise of harmlessness. Changed command definitions or a broader environment require renewed authority; no “run any bash command” grants.
- **Commits:** exact selected scope and message; no unrelated staged work; required identity/signing/hook behavior verified; prohibited/protected branches respected. Checkpoints must not claim final integration verification if it has not happened.
- **Preparation:** only explicitly permitted private, workflow-owned history is eligible for automatic rewriting. Shared/published/uncertain history, semantic conflicts, and ambiguous ownership require intervention; never conceal a failed rebase with a reset.
- **Integration:** allowed local target and method, exact candidate, passing current required checks, clean registered checkouts, correct identity, no unresolved restrictions, and no conflicting writers. No check waiver or method substitution just because Automatic is selected.
- **Cleanup:** only the workflow's named resources after verified successful integration/disposition; no unmerged work, unrelated branch, primary checkout, dirty state, or unsafe active use. “Ignored by Git” does not mean disposable.

Cleanup has separate permission even when both it and integration are automated. Known generated artifacts need an explicit bounded retention/deletion policy plus an unchanged inventory and safe path handling; default to retaining unknown artifacts. Session relocation, failed forks, active terminals/subagents, malformed/unavailable session inventory, and admission races must be handled before deletion. No force-remove shortcut.

**Remote actions remain a separate capability family, disabled/out of scope for initial execution.** A PR-oriented project can choose prepare-and-handoff with visible instructions; this is not local merge or publish permission. An eventual remote adapter needs its own destination/operation consent, credentials boundary, and tests. Check commands can themselves access networks; their code-execution consent must disclose that rather than treating verification as inherently read-only.

## 7. Durable chat cards without patch-sized model context

Use a server-owned **action record**, an immutable **candidate/diff artifact**, and a separate live **execution/approval capability**. These have different lifetimes.

Small `custom` session entries anchor action IDs to transcript history. Unlike `custom_message`, SDK custom entries do not enter model context. Store heavyweight patches/check logs and action transitions in private Pi Web storage with atomic writes, bounded reads, digests, and revisions. The model receives only concise facts such as “commit abc… created; 4 files; checks pending; action …”. It can explicitly request more information when needed.

Every managed operation uses the same cards, whether automatic, approved, declined, or manually initiated through the sidecar. Coalesce updates into one visible action card; keep a compact workflow summary to avoid dozens of progress bubbles.

States distinguish **proposed, awaiting decision, executing, succeeded, declined, cancelled, expired, blocked, failed, and recovery required**. Approved is not committed. Closing a dialog is not success. A ref update followed by index failure is partial success with its actual OID, never an ordinary retryable error. Record authorization provenance and actual author identity in the result.

Each commit card provides selected files, message, exact parent/result IDs, timestamps, and expandable **side-by-side old/new diff**, with unified/raw alternatives. Reuse `CommittedPatchDiff` through a multi-file adapter. Integration compares captured target tree to actual proposed/result tree; it also supports individual commits and contiguous cumulative ranges. Binary and metadata-only changes get honest summaries; oversized candidates are never silently presented as complete.

Persist the reviewed candidate artifact **before** exposing an approval or starting an automatic mutation. Do not derive historical cards from today's branch or working files. Declined/unreachable candidates and post-cleanup cards must survive Git GC/worktree removal. Persist bounded text patches by default; arbitrary full-file context expansion is a separate storage/privacy feature, not promised by a hunk diff. Export must explicitly account for private artifacts; missing/pruned data gets a visible placeholder, never substituted current content.

History endpoints work without starting an AgentSession. SSE supplies revisioned updates; GET reconciliation repairs missed events. In-session navigation/compaction uses raw branch ancestry for card anchors, not compacted model context alone. Git effects do not rewind when conversation history does. Forks copy read-only history references, not pending authority; shared references survive deletion of an ancestor session.

After browser reload, a pending card is actionable only while its original server-owned request remains live. After server restart, pending requests become interrupted/expired, and uncertain execution becomes recovery-required. Display records never reconstruct approval tokens, verification authority, or jobs. Track action phase and intended/result OIDs around mutation so crash recovery cannot accidentally duplicate a commit or integration.

Disabling new cards cannot disable required safety journaling. Artifact retention is independent of workspace cleanup; explicit artifact deletion is separate, with clear privacy/storage consequences.

## 8. Work with different project definitions, honestly

Do not hard-code `main`, `rst-main`, Node commands, GitHub, unsigned commits, or the current Pi Web merge implementation into the product contract.

Accept existing `AGENTS.md`/project documentation and optional typed data-only project definitions. A manifest is not mandatory. The agent can propose a normalized profile from prose, citing its sources; the UI exposes it for correction/adoption. An LLM interpretation is not a proof that all repository restrictions were parsed. Ambiguous or unreviewed requirements block unattended affected stages. Repository-supplied configuration can declare requirements and recipes but cannot confer user consent or silently run code. There must be one maintained owner for each rule, not a prose profile and a generated manifest that silently disagree.

The initial execution contract is deliberately explicit:

| Project pattern | Delivery commitment |
| --- | --- |
| Selected direct commits, new/adopted linked worktree, leave-for-review | Core managed workflow, with ownership/admission checks. |
| Local unsigned non-FF integration and ordinary argv checks | Core native execution; ordered environment/subdirectory recipes included. |
| Private-branch rebase, FF, squash | Extended capability via tested native work or a versioned optional CLI adapter; not enabled merely because the preference can be stored. |
| New branch in the current checkout | Explicit supported start capability before exposure; otherwise adopt an already-created branch or hand off. |
| Required hooks/signing, LFS/filter/submodule or unusual index semantics | Early manual/handoff until a backend proves the required behavior; no claim of broad automatic support from the first release. |
| Remote/PR-only integration | Prepare-and-handoff initially; separate future remote contract. |

An adopted prose-derived profile is a reviewed private project definition with source paths/digests, owned through the project editor; it does not rewrite AGENTS.md or become a competing authority. Source changes show a focused profile diff and require affected automation to reconcile once, rather than repeatedly rediscovering the same choices. Explicit structured project definitions remain the data owner where supplied; private overrides and grants stay separate.

Support representation of:

- Current checkout/direct commits, feature branches, new or existing linked worktrees, and leave-for-review workflows.
- Different local bases and targets, no integration, allowed target sets, protected branches, and naming rules.
- Non-FF merge, FF, squash, or a human-owned integration path; only advertise execution after a backend supports the selected semantics.
- Ordered commands for npm, Maven, Python, Nix, etc.; explicit subdirectory cwd and environment launchers; required versus path-conditional checks. Ambiguous selection runs the conservative required set or asks, never silently omits verification.
- Monorepo subdirectory requirements without losing canonical Git identity; separate repositories remain separate workflows and grants, not one cross-repository transaction.
- Authorship/signing/hooks/filters/LFS/submodule policies and unsupported Git states. Detect and explain incompatibility before work starts where possible; never disable a project's hooks or signing to fit the engine.

A backend capability model separates Native, Supported adapter, and Manual/handoff. Reuse the current guarded native engines. An optional version-negotiated `git-workflow` CLI adapter can cover local preparation and additional integration mechanics without being mandatory for all Pi Web installations. It uses executable/argv, structured plans/results, known side effects and the same authority/journal, not agent-invented shell parsing. An adapter is never an escape hatch for a safety refusal. Do not blindly import CLI receipt IDs as native verification authority.

Direct bash/terminal Git is not magically instrumented. Where explicitly supported, import an observed result into a read-only card with provenance and verified IDs; do not retroactively claim a candidate approval or full diff that was not captured. Broader hook/signing behavior needs a capable reviewed backend, not a generic command execution plugin disguised as a workflow.

## 9. Instruction alignment across Pi Web and Nix

The source of installed policy is in `~/nix/my_nix_os`:

- `home/presets/pi/AGENTS.md`: global mutation guidance, currently “always ask” before primary-checkout work.
- `home/presets/skills/git-worktrees/SKILL.md`: shared lifecycle and current CLI preference. Its inspected installed copy matches this source.
- `home/presets/skills/project-workflow-align/`: baseline and adaptation template; future alignments must not reintroduce contradictory rules.
- `home/presets/ai-agents.nix`: installs the instructions/skills across multiple harnesses. Its mutable-config activation also reseeds Pi settings, so do not put user-edited workflow state where activation overwrites it.
- `docs/guides/git-workflow.md`: optional CLI contract. Do not silently change its standalone consent semantics just to support one harness.

Proposed global contract, conditional on a supported host-managed workflow:

> Prefer the host's managed Git workflow when it exposes validated scope, effective policy, and authorization state. A matching user-created standing grant may satisfy the named lifecycle decision where repository rules permit. Do not ask again for a decision already covered, and do not execute a declined or disabled action through a shell fallback. Without that capability or grant, use the conservative interactive lifecycle. Exact-state verification, recovery, ownership, and explicit remote boundaries always remain.

Distinguish a server-validated grant from text pasted into a prompt or an agent-created settings file. The instructions alone are not a security boundary against arbitrary same-user filesystem access. Conditional wording is essential because these instructions also reach harnesses with no Pi Web tools.

For Pi Web's own project profile, propose retaining dedicated worktrees from local `rst-main`, local non-FF integration, required checks, no production development build, and separate publication. Explicitly replace unconditional fresh human-approval wording with **exact-candidate authorization by fresh review or a matching supported standing grant**, if the user adopts that change. Other projects may retain mandatory human approval or prohibit integration entirely. Do not bulk realign repositories or treat this proposal as an active exception.

Instruction deployment is a separate Nix change, verified against compatible and absent-tool harnesses and activated explicitly. Full automation's user-facing rollout requires compatible effective instructions; a runtime flag alone must not advertise a question-free workflow while old unconditional approval rules remain loaded. For supported managed actions the aligned guidance directs agents through the controller, not opportunistic shell Git; refusal is not fallback permission. Do not edit generated `~/.pi` symlinks or broad personal policy during this documentation task.

## 10. Safety, concurrency, and recovery requirements

- Controller transactions journal intent before mutation and terminal outcome afterward; artifact failures before execution stop the operation. Failure to record after a mutation becomes recovery-required, not a replay trigger.
- Gates must cover prompts, new session startup, session move/fork, managed terminals/check subprocesses, and task workspace ownership, not only currently running wrappers. Report the actual busy resource/session and remediation instead of a combined trust/busy guess.
- Treat project resource trust, command execution grants, and Git mutation consent as separate facts. A checks grant does not enable project extensions. Offer the relevant trust decision in the workflow UI without silently granting it or forcing an unrelated navigation detour.
- Mutations reserve only the relevant checkouts/resources for the necessary period; do not hold locks while waiting for human input. Revalidate after reacquiring them. Known read-only activity need not block unrelated work once safe admission is proven; otherwise retain conservative behavior.
- External Git/CLI writers remain outside in-process gates. Use conditional ref/index updates and fail closed; do not claim atomicity across arbitrary processes. Missing inventory or uncertain state blocks destructive actions.
- A server crash may leave a verification/adapter subprocess alive. Record sufficient process/resource ownership to prove it exited or to stop only that owned process safely; do not trust a recycled PID. Until reconciled, quarantine the affected workspace from resume, new mutation admission, and cleanup. “No replay” alone is insufficient.
- Keep live one-time capabilities separate from durable audit data. Disabling, Stop, expiry, duplicate responses, and restarting cannot resurrect an operation. Return typed blockers/errors through the SDK's actual error contract, not an ignored `isError` property on a normal return object.

## Consequences and rollout

This is more than a UI restyle: it introduces one policy resolver, an authorization model, a task coordinator, durable action projection, and instruction alignment. Reuse the existing Git primitives and split-diff renderer; do not rewrite Git wholesale.

Ship incremental vertical slices: unified settings and result cards first; one setup/start/finish path next; bounded automatic local integration and safe cleanup only after journaling, grants, admission, and recovery tests pass. Existing explicit approvals remain the compatibility path. Unsupported capabilities must be visible as unavailable, not selectable promises.

Migration preserves absence, legacy opt-out, and explicit consent separately, reconciles the two old preference stores without inventing authority, and never silently upgrades an old session to Automatic. Unknown newer permission records must fail closed; downgrade must not revive an older permissive record. Keep original records for rollback and offer explicit adoption with a diff.

Success means a configured, eligible task can complete with **no repeated setup or per-commit questions**, and—with expressly enabled and permitted automation—no routine integration/cleanup interruption. The history still shows exact actions and their authorization. An unfamiliar/restricted project gets one consolidated setup and only genuinely necessary later decisions, not a pretend universal autopilot.
