# Project branch & worktree manager

## Goal

Add **Manage branches & worktrees…** to the selected project's worktree menu. Open a project-scoped overview of accumulated local branches and registered worktrees, their integration into a selectable local target, commit dates, integration evidence/dates, and cleanup blockers. Provide explicit, independently reviewed removal of an integrated worktree, its local branch, or both.

The user approved implementation with “alright. implement” on 2026-10-10, after independent plan reviews and the decisions below. Implementation does not authorize deleting real project resources, local integration, publication, deployment or cleanup of this feature worktree.

Workspace: `/home/robert/projects/3rdparty/pi-web-worktrees/project-worktree-manager`, branch `feat/project-worktree-manager`, based on local `rst-main` at `6e337e5681c187c13e65b87cbcc7a2cde8d3d000`. CodeGraph initialized successfully. Planning initially changed only this document; implementation subsequently stayed in this linked worktree.

## Post-rebase adaptation

After the first implementation checkpoint, the user requested rebasing onto current
local `rst-main` and rerunning **all** acceptance, not only browser checks. The
initial conflict was aborted and the clean original tip retained in
`backup/project-worktree-manager-pre-rebase-20261010T151655Z`. The user explicitly
approved following `rst-main`'s newly English-only interface instead of the
original three-language plan. Chinese catalog deletions were preserved; the
manager contributes only English messages, and its catalog test now verifies the
shipped English keys. Session-launch and manager browser-suite wiring were combined.

The feature was rebased onto `3f1bce8af835c9acb01f62a8a5b70854cbfe6df3`, which
includes stale-idle-history recovery and ordinary-session launch changes. The
historical checkpoint below remains evidence for the pre-rebase source only.
Fresh common, plugin, manager/general/plugin-browser and terminal acceptance is
required before integration; no earlier pass is relabeled as rebased acceptance.

## Independent review and accepted adaptations

Two independent read-only reviews were completed on 2026-10-10: technical correctness/cleanup safety and user experience. They inspected the plan and relevant current source; neither ran application tests or built a prototype. Findings are incorporated below, not claimed resolved by runtime evidence.

User decisions after review:

- Show the recorded merge-commit date as graph evidence, not the actual time the target ref received commits.
- Idle chats do not block removal. Warn that history remains but the working folder disappears; continuing may require moving the chat. Running/starting managed sessions, active terminals and the selected checkout remain protected.
- Unignored untracked files block manager cleanup in v1. Show the paths for manual resolution; no explicit deletion-root selection for them.
- Start with all branches visible, integrated entries first; within each group, oldest tip-commit dates first.

**Visible corrections to the first draft:** “Integrated at” overclaimed historical timing and becomes **Merge commit date**; shallow negative ancestry becomes Unknown; idle displayed chats become warning-only. Visible-row date loading cannot support global date sorting, so that sort explicitly prepares all matching dates. Supplying a no-chat host to the executor cannot guarantee preview-only behavior under Allow: prove the prepare/confirmation seam before exposing cleanup.

Other accepted planning corrections: hardened status reads (including filesystem-monitor refusal), cheap eligibility hints separated from full artifact inventory, concrete operation lifetime/recovery, direct project-target settings navigation, compact rows, preserved list position and behavioral accessibility acceptance.

## Plan Relationship

- This plan owns the new **manual project housekeeping surface**, its read APIs and standalone browser cleanup adapter.
- Existing Git Explorer remains the history/diff browser; do not replace it or its captured-object contracts.
- `2026-10-08_session-git-policy-plan.md` owns the existing plugin policy/tool/receipt mechanics. Reuse delivered behavior, without adopting its unrelated completion obligations.
- `2026-09-28_integrated-git-workflow-plan.md` is explicitly retired as a future-work queue. Do not restore its managed tasks, adoption, legacy data, start/finish orchestration or mandatory chat relocation.
- Preserve ADRs 0014–0019: optional plugin, selected-repository policy, generic core host plumbing, exact artifact authority, durable reviews and nested-path protections. A new ADR must describe the bounded standalone browser operation host before implementing that boundary.

## Context and repository evidence

| Existing owner | Evidence and consequence |
| --- | --- |
| `components/SessionSidebar.tsx` | Worktree menu, create/attach controls and manual removal live here, not in a separate WorktreeSwitcher component. Add a small launch point; put the new view in a separate component. |
| `app/api/worktrees/route.ts`, `lib/worktree.ts` | Existing standalone discovery and allowed-root guards. Switcher integration badges hardcode `rst-main`; that is not a generic designated target or cleanup proof. |
| `lib/git-explorer.ts` | Useful examples of literal local-ref selection, captured tips, stale-read rejection, bounded output, disabled replacement objects and disabled lazy fetch. Its checkout helper requires a local branch, so it cannot directly cover detached-worktree inventory. |
| `plugins/git-workflow/manifest.ts`, `lib/plugins/settings.ts` | Existing target setting is `targetBranch`, default null. Project identity is the physical common Git directory. Standalone project scope uses built-in/global/project settings, never an open chat's session overrides. |
| `plugins/git-workflow/cleanup.ts` | `captureCleanup` and `performCleanup` are chat-independent via injected access, but not independently sufficient authorization. Reuse their integration, inventory, revalidation and partial-effects protections. |
| `plugins/git-workflow/server.ts` | `executeGitOperation` accepts an optional session but requires a host for live approvals, immutable reviews, directory reservations and durable receipts. There is no exported standalone preview route today. |
| `lib/plugins/types.ts`, `lib/rpc-manager.ts` | Current approval/operation-receipt implementations are chat-owned. A no-chat manager needs a bounded generic browser operation host, not a fabricated chat or a bare cleanup endpoint. |
| `lib/directory-reservations.ts`, `lib/terminal-manager.ts` | Existing generic reservation and managed-use inspection can protect final effects against new Pi Web activity. They do not lock out external writers or another server process. |
| `components/SessionSidebar.worktree.test.mjs` | Existing tests largely inspect source strings. Preserve them, but add executed helper/route tests and actual desktop/mobile browser coverage for this feature. |

Read-only independent research confirmed the cleanup reuse boundaries. No application tests, browser acceptance or actual resource cleanup ran during planning.

## Product contract

### Entry point and layout

- Add **Manage branches & worktrees…** beside **New worktree…**, outside the menu's scrollable/filtered checkout list. Keep the agreed worktree-menu entry point; no second project-menu entry in v1. The subdirectory/root hint explains how to reach management.
- Open a large dialog: desktop table with expandable details; mobile compact stacked rows. Primary columns: **Branch / Worktree**, **Integration**, **Latest tip commit**, **Merge commit date**, **Cleanup**. IDs, subjects, full paths and detailed blockers belong in Integration evidence / Checkout state / Cleanup options sections.
- Header: project identity/path, **Integration target** with provenance, Refresh, Close; full captured target tip in details.
- Controls: whole-inventory name/path search, All / Integrated / Not integrated / Unknown filters, combinable Has worktree / No worktree / Diagnostic registration filters, and sorting by branch name, tip date or merge date.
- Initial view shows all branches, integrated first and oldest tip commits first within each group, with branch-name tie-breaking. Keep target/diagnostic rows distinct from cleanup candidates. Expose sort direction. Unloaded, unavailable and not-applicable dates are distinct; unknown dates are not epoch timestamps.
- Counts separate local branches, registered worktrees, diagnostic registrations and integration states. Show result totals/page ranges and Clear filters. Distinguish no resources, no matches, target needed and inventory failure. Use Integrated, never Safe to delete.
- Opening/browsing must not switch checkout, change chat cwd, create/move a session, check out a branch or write settings.
- Project/target changes invalidate proposals and abort old reads. Preserve browsing state/list position after refresh/cleanup. Worktree-only removal leaves its branch row as No worktree. Returning from settings or explicit checkout navigation restores context but requires a fresh proposal.
- Dispatched operations settle and retain outcomes even after their rows disappear.
- Accessibility acceptance: named modal, focus containment/background inertness, focus restoration, expansion buttons with aria-expanded, named sort controls/aria-sort, keyboard-reachable blocker text, labels beside icons, polite announcements and wrap/zoom containment. Define Escape for details/review/execution; a card shell alone is not a modal.

### Inventory and row fields

Show all local branches, including branches without worktrees, joined with all registered worktrees. Detached, locked and missing/prunable registrations are visible diagnostic rows; do not silently hide accumulation just because the existing switcher does.

Each branch row contains:

1. Branch name and captured full tip (short form in the table; full ID in details).
2. Associated worktree path(s), or **No worktree**.
3. Main checkout, selected checkout, target branch and detached/locked/missing badges where relevant. Main checkout and integration target are distinct concepts.
4. Integration state relative to the selected target: **Target itself**, **Integrated**, **Not integrated**, or **Unknown**.
5. **Latest tip commit** timestamp: the captured tip commit's committer date. Subject/author date are in details. Rebasing can change committer dates; this is not filesystem modification time, branch-ref update time or a maximum ancestor timestamp.
6. **Merge commit date** under the history rule below, with evidence commit/source in details. Use Loading before calculation, Date unavailable with a precise reason after an inconclusive calculation, and Not applicable for unintegrated/target rows. No vague confidence score.
7. Working-state summary: clean tracked/untracked source, dirty, ignored content present, unavailable, or not applicable. Ignored content is distinct from cleanliness and is not automatically generated/disposable.
8. Cheap eligibility hints/blockers and **Review cleanup…** to initiate authoritative preparation. Do not hash complete artifact/dependency trees while browsing or treat hints as execution authority.

Use localized absolute dates; full time/timezone must be keyboard/touch accessible, not hover-only. Visible note: dates are recorded commit dates, not verified integration times or branch activity.

A branch may have been integrated earlier and then received new commits. Status must describe its **current captured tip**, not its name's historical usage.

### Target selection

- Default to the existing effective project/global `targetBranch` if it names an existing local branch. Show where that value came from.
- If no target is configured or it is missing, show inventory/tip dates with **Choose a target to assess integration**. Require a target for integration/cleanup, not for opening the manager. Do not hardcode rst-main, assume main/master, parse instructions or fetch a remote default.
- List literal local branches without checkout/settings writes. An alternative is labeled **Temporary comparison — not saved**; retain it only in current-dialog state in v1.
- Deep-link existing settings to this repository, Project scope and targetBranch, with a clear return path. Do not open at unrelated global settings or add a competing target store.
- Comparison does not override cleanup policy. Show mismatch immediately beside the selector with **Use designated target** / **Open project target setting**, not only after cleanup is attempted. Refuse disallowed cleanup targets. Ask target selection may be answered by explicit browser selection without saving it.

### Integration status and date semantics

**Integration proof:** `featureTip` is an ancestor of or equal to the captured target tip. A demonstrated path proves containment even in shallow history. Exit 1 means Not integrated only with complete ancestry; conservatively report **Unknown — incomplete history** for shallow negatives. Missing objects, timeout, unsupported graph modifications and other failures mean Unknown. Disable replacements and refuse legacy grafts. No patch-equivalence inference. Reverting changes does not undo containment; this is not a claim of equivalent current file contents.

**Date evidence:** Inspect the captured target's first-parent history for the transition from a history not containing the tip to one containing it. If the introducing commit is a merge, show its committer timestamp as **Merge commit date**, with full ID. This proves graph introduction of captured commits, not historical source-branch identity or when the target ref moved.

A target can fast-forward onto a pre-existing merge or have rewritten history. Its recorded merge date remains useful graph evidence but cannot establish actual target-integration time. State this in details; do not call it Integrated at.

- A feature integrated through an intermediate branch can have a reliable target-entry merge commit under this definition; do not claim the feature was directly merged by name.
- If introduction is an ordinary/root commit, fast-forward observation time cannot be recovered from history. Show integration status but **Unknown** integration date.
- Do not use merge-message matching, Git author dates, commit-date ordering, reflog existence or Pi operation receipts as the universal historical timestamp source.
- Follow graph/first-parent order, not timestamp order; timestamps can be nonmonotonic or user-supplied.
- If traversal is incomplete (shallow history, missing objects, configured read budget), disclose **Unknown — incomplete history** rather than inventing a transition.
- The target's own row is Target itself, without date/action. Another branch sharing its tip is Integrated; if the tip is a graph-introducing merge, show its recorded merge date under the same limitations. Equality does not prove a distinct integration event.
- The cleanup proof can pin the captured target tip as `integrationCommit`, even when the historical integration date is unknown. Historical date availability is never a prerequisite for proven containment or a source of deletion authority.

## Architecture

### Read-only inventory

Proposed ownership:

- `lib/worktree-management.ts`: richer registration/ref inventory, literal branch validation, captured-tip containment, status summaries and integration-event reads. Keep existing switcher discovery lightweight and backward compatible.
- `lib/worktree-management-types.ts`: client-safe structured DTOs, explicit unknown/error reasons, capture identity, paging and eligibility hints.
- `app/api/worktrees/manage/route.ts`: allowed-root/physical-checkout authorized GET reads for inventory and captured row details. No Git mutation, shell interpolation, checks, instruction parsing or remote traffic.
- `components/WorktreeManager.tsx` and a small testable state/helper module: presentation and cancellation/selection orchestration.
- `components/SessionSidebar.tsx`: launch point and explicit refresh callback after acknowledged cleanup.

Capture repository identity, local target ref/tip, relevant branch refs/tips and worktree registrations. Read objects by full captured IDs. Revalidate refs and physical identity before returning a coherent result or fetching details; stale captures return a refresh-required conflict. This is optimistic validation, not an atomic snapshot against external Git writers.

Use NUL-safe registration/metadata parsing, `toNativePath` and `samePath` for paths, literal full refs for branch authority, and the existing path-security boundary. Ref names are not filesystem paths. Cover SHA-1/SHA-256, Windows and UNC path identities. Refuse unregistered/arbitrary Git directories and unsafe path aliases. A detached registered source may still browse repository inventory; destructive actions retain the cleanup engine's stricter supported-checkout requirements.

Capture tip metadata/integration classification for the whole inventory before globally sorted paging; expose loading/completeness, never classify unread branches as unintegrated. Bound subprocess fan-out and use bulk captured-ref classification where correct. Search/filter/counts/ordinary sorting cover the whole capture. Measure many-ref/deep-history fixtures and cache first-parent traversal by captured target tip.

Load status/merge dates progressively for visible rows. Global merge-date sorting starts **Load dates for all matching branches**, with cancellable observed progress. Keep the previous order until all matching calculations settle, including explicit unavailable results. Not loaded is not Date unavailable. Proposed budgets: 50 rows/page, at most 3 expensive concurrent reads; choose/document the history budget in the spike. These are not measured claims. Cleanup inventories remain complete/cancellable and never inherit display/history truncation.

Use a hardened read wrapper: sanitized environment, literal arguments, no optional locks/replacements/lazy fetch, protocol refusal, `-c core.fsmonitor=false`, cancellation and bounded output. Define submodule status handling; prove no project-command execution with filter/fsmonitor sentinel fixtures. Do not call getGitStatus merely for counts: it computes diffs/untracked content. Expose/reuse a narrow status reader with clean/process-filter preflight. Unsupported reads return Unknown, not hidden command execution. Core must not import the optional plugin merely for these safeguards.

### Optional plugin and standalone actions

Overview works with the plugin disabled. Show one **Cleanup requires Git Workflow. Browsing remains available.** banner, **Open Git Workflow settings**, and a note that enablement applies to all projects. Preserve context on return and refresh policy/capabilities. Historical outcomes/reviews remain readable while disabled. No mutation fallback. Existing switcher controls keep their separately documented behavior; never present force removal as the remedy for blocked manager cleanup.

Add the smallest typed **generic project-action capability** to the bundled-plugin contract and registry. Core routes/host/UI handle opaque action IDs, project authorization, review/receipt storage and transport; only `plugins/git-workflow/` interprets cleanup resources, Git policy or Git effects. Do not hardcode Git permission logic into chat or generic host code.

Proposed additions, to finalize in step 1:

- Generic adapter in `lib/plugins/types.ts`, implemented through `plugins/git-workflow/index.ts` and a plugin-owned `project-management.ts` module.
- Generic prepare/decision/status endpoints under `app/api/plugins/bundled/[id]/project-actions/`.
- Generic no-chat host/storage in `lib/plugins/project-operations.ts`, with private versioned owner-only operation records and exact review references under Pi Web's private data directory.
- Generic standalone review authorization/read endpoint backed by `lib/plugins/review-store.ts`; ownership comes from the server's operation record and current allowed project, never an arbitrary supplied review UUID.
- Reuse `components/plugin-ui/PluginCard.tsx`, review attachments and the existing bounded confirmation shell in a standalone project-action dialog.

This is an operation audit/transport host, not a task registry or new managed Workflow. Never fabricate a hidden chat to gain existing session receipts, import another chat's policy, or turn a historical receipt into authority.

Proposals bind authenticated browser action, physical repository, exact refs/proof/registration, selected invocation checkout, inventory and relevant policy revision. Opaque handles are single-use/server-owned; reject forged/reused/expired/restarted proposals. Claim decisions atomically. Request IDs/idempotent preparation lookup prevent a lost response from creating/executing a second operation.

Define operation lifetime independently of HTTP requests. Closing/disconnecting cancels pending preparation/review; after dispatch, native effects settle and status remains available. Explicit Stop prevents only undispatched steps. Never release reservations on request abort. Define expiry/HMR/restart invalidation; persisted records never reconstruct authority. Persist prepared/authorized/effect-intent/outcome states before their boundaries. Restart leaves unfinished records Outcome unknown, with inspection but no replay.

Persist completed/attempted steps where durably observed; crashes/failed final writes cannot fabricate settlement. ADR must specify post-effect persistence failure, historical access after disable/checkout disappearance, and deliberate allowed-root admission of related registered checkouts. Historical review reads authorize through saved operation ownership/project access, not the existence of the removed worktree. Recent outcomes survive row disappearance. Limit this host to the delivered capability, not a general job framework.

Browser cleanup always confirms the exact review. **Do not call executeGitOperation as prepare-only:** Allow without unapproved artifacts can bypass pluginCard and execute. Add a shared prepare/confirm/effect seam or unconditional browser confirmation hook; prove preparation has zero resource effects under Ask/Allow, preserving tool semantics/provenance. Deny blocks; Ask uses one confirmation. Allow never deletes on browsing/selection and is not relabeled configured Ask. Unlisted artifacts require one-time consent in that same review, with no settings write or additional dialog.

### Cleanup options and execution

For one proven-integrated local branch at a time, allow:

- **Remove worktree; keep branch**.
- **Delete local branch** only if no registered checkout retains it.
- **Remove worktree and delete local branch** in one exact-resource review.

Ignored artifacts are discovered/displayed by the existing engine; ignored status is never authority. **Unignored untracked files block manager cleanup in v1**, with paths/manual-resolution instructions. No explicit generated-root selection or automatic disposable classification. Existing agent-tool explicit-root support stays unchanged. No artifact-only/batch housekeeping.

Happy path: open manager → confirm target → filter Integrated → select row/resources → **Review cleanup…** → **Checking eligibility / Inspecting ignored content / Ready for review** → inspect **Will remove / Will keep** → operation-specific confirmation → outcome → continue at the same position. Full artifact hashing begins only at Review cleanup. Progress is observed, not invented percentages. Review shows exact branch/path, proof, counts/size and irreversibility. Partial/unknown outcomes show Completed / Attempted / Remaining, View recorded review and Refresh actual state, never generic Retry or Undo.

At prepare and immediately before effects, reuse `captureCleanup`/`performCleanup` and the executor's policy/review/receipt protections. Keep exact non-dereferencing conditional branch-ref deletion; no `branch -D`, force worktree removal, reset, stash, prune or branch-config deletion.

Protect main checkout, target branch, invocation/source checkout and current selected checkout. Managed starting/running sessions and active terminals block removal through authoritative observers. Bind selected invocation checkout into the proposal; project/worktree changes invalidate review. Offer explicit navigation away from a Selected checkout blocker, preserving list context but discarding the proposal. Name busy chats/terminals where host metadata supports it; no automatic termination.

**Idle chats, including displayed chats, do not block cleanup.** Warn that history stays but the working folder disappears; continuing may require moving the chat. No cross-tab presence tracking, busy classification for idle wrappers, or proposal cancellation solely from displaying another idle chat without changing selected checkout. Use validated session/project metadata for warnings; browser cwd claims do not establish policy/access ownership. Never automatically move/delete chats or terminals.

Acquire the existing generic directory reservation after approval, atomically with busy inspection, across final validation and native settlement. Preserve existing resource, filter, sparse/hidden-index, symbolic-ref, locked/prunable, dirty/untracked, source-parent, symlink/mount and nested Linux no-follow restrictions. External processes and other Pi Web servers remain outside that reservation.

Refresh inventory and sidebar worktrees after observed success or partial effects. Report completed steps, attempted step and retained resources; never blindly retry, silently roll back or claim cancellation undid a dispatched deletion. Reservations release only after native settlement. If transport disconnects, expose the operation status rather than inviting a second execution.

## Non-Goals

- Squash/cherry-pick equivalence, searching every potential destination branch, remote branches, fetch/pull/push or provider/PR lookup.
- Automatic cleanup, background reapers, batch selection, age-based deletion, force cleanup or removal of unintegrated/detached/stale registrations.
- New main-branch inference/configuration stores, session settings inheritance for project actions, parsing AGENTS.md for defaults, or restoring removed managed Workflow.
- Branch checkout/creation/rename, session relocation, terminal termination, historical session deletion, branch-config cleanup, backup deletion or review-store garbage collection.
- A claim that Git dates are reliable wall-clock audit records or containment alone proves disposable filesystem contents.
- Production builds, installed-service changes or remote publication during development.

## Plan

### 1. Resolve the standalone boundary and date algorithm before UI integration

- [x] Add graph fixtures for ordinary/non-FF/nested/octopus merges, fast-forwards onto ordinary/pre-existing merge commits, equal merge tips, rewritten history, reverts, new commits after integration, squash/cherry-pick, nonmonotonic dates and shallow hidden ancestry with both endpoints present; prove containment/date-evidence/Unknown rules.
- [x] Audit executor/host and record the narrow ADR covering prepare-without-effects under Ask/Allow, browser confirmation provenance, request/decision claims, operation cancellation, expiry/HMR/restart, failed final writes, historical access and related-checkout admission. Acceptance: reviewed sketch plus no-effects preparation spike; no fabricated sessions, permission bypass, presence tracker or task registry.
- [x] Specify DTOs, literal branch/path identities, first-parent traversal budget and project-action states. Acceptance: executed fixture spike distinguishes stale/unknown from negative containment, and a prepare/confirm/status design maps onto existing cleanup protections.

### 2. Implement captured read-only inventory

- [x] Add rich NUL-safe worktree registration parsing without changing the switcher's existing filtered list; test branch-only, detached, missing/prunable, locked, main/selected and unusual path/name rows.
- [x] Implement ref capture, tip metadata and containment against the selected local target; test missing configured targets, target self-row, new branch commits, independent project identities, SHA-256 and unavailable/shallow object reads.
- [x] Implement progressive merge-date/narrow-status reads with hardened dispatch, bounded concurrency/captured-target caching and incomplete-history reasons; test filter/fsmonitor sentinels, submodules, ignored/dirty state and timeout/cancellation. Measure many-ref/deep-history fixtures and prove global date-sort completeness.
- [x] Add the management GET route with allowed-root/physical-registration authorization and captured-tip revalidation; run route tests proving no writes/remotes, rejected revision expressions, path alias/UNC handling and stale-ref conflicts.

### 3. Add no-chat operation host and plugin adapter

- [x] Extend generic bundled-plugin capabilities/registry and add project-action routes without Git conditionals in core; test unknown/disabled capabilities, malformed payloads, allowed-root/origin checks and project-only settings scope.
- [x] Implement private durable standalone operation records and operation-bound exact review reads; test atomic persistence, failed pre-effect writes, integrity/ref authorization, reload and restart-unknown state. Preserve existing session-review access and retention.
- [x] Adapt the existing Git cleanup preparation/execution to the standalone host, sharing—not copying—policy checks, capture/effect machinery and partial-result reporting; run the separate plugin tests and demonstrate identical safety refusals for tool/browser callers.
- [x] Implement single-use decisions, idempotent preparation, policy/selection invalidation and reservations; test concurrent duplicate decisions, zero-effect artifact-free/allowlisted Allow preparation, disable/Deny, target mismatch, Stop/disconnect/restart and new admission. Prove idle displayed chats warn without blocking, while active sessions/terminals still block.

### 4. Build the manager view

- [x] Add the launch entry and separate responsive dialog, leaving switcher selection/create/attach behavior intact; execute component/state tests and verify opening needs no chat and never switches cwd.
- [x] Render compact inventory/details, target provenance/temporary-comparison labels, immediate mismatch guidance and direct project-field settings navigation; verify whole-inventory filters/counts, integrated-first oldest-tip default, global date-sort preparation, retained position, stale cancellation and distinct empty/error/loading/unavailable states.
- [x] Add resource choices and Review cleanup stages/confirmation/outcomes; test rejection/no effects, ignored inventory, unignored-file refusal, selected protection, warning-only idle chats and outcomes after row disappearance.
- [x] Maintain visible/accessibility text in the English catalog (user-approved post-rebase adaptation); verify message completeness, absolute dates/timezones, modal/focus containment/restoration, expansion/sort semantics, keyboard blockers, stage-specific Escape, announcements and zoom/wrap/narrow-screen containment.

### 5. Adversarial and browser acceptance

- [x] Extend disposable cleanup regressions for unchanged/moved/deleted/symbolic refs, registration changes, checked-out retained branches, dirty/untracked/ignored source, symlinks, mounts, locked/prunable paths and supported/unsupported nested deletion; assert unchanged resources on each pre-effect refusal.
- [x] Test active/starting sessions, descendant cwd terminals, current-selection changes and new admission during reservation; preserve honest partial-effect and failed-final-receipt evidence rather than resetting fixture state to hide it.
- [x] Add `e2e/worktree-manager.mjs` through the existing browser-suite entry point, plus a documented `E2E_WORKTREE_MANAGER_ONLY=1` switch. Verify no-chat browsing and plugin-disabled overview, integrated/unintegrated branch-only rows, date evidence, target change/stale reads, explicit artifact review and reject/success/partial recovery at desktop/mobile widths. Include the flow in general browser acceptance.
- [x] Run an independent read-only safety review of capture/approval/effect boundaries and address findings with targeted regressions. Keep one writer and coordinate acceptance budgets.

### 6. Documentation, verification and handoff

- [x] Update `docs/worktrees.md` with date evidence, target setup, idle-chat warnings/blockers and recovery; update focused source/plugin/browser guides and README only where needed, not AGENTS.md. Clarify switcher wording as Current tip contained in rst-main and Main checkout in the shipped English interface, without changing its existing badge target; manager always names its selected target.
- [x] Run focused selections while editing, then full offline/core acceptance and separate plugin/browser acceptance on stable source; record captured input identity, commands, selections, outcomes, artifact paths and actual command runtime separately from preparation/review.
- [ ] Review and create coherent local feature commits after source approval; reassess the rebased candidate against current local `rst-main`. Present exact candidate/target IDs and verification for separately approved unsigned non-FF integration. Retain resources if approval or acceptance is blocked.

## Verification commands and evidence

From this worktree, after implementation is authorized. Add the new files before using their focused commands; these are planned commands, not passing evidence.

```sh
# Focused core/route/UI-helper iteration (repeat --file for further changed files).
nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs \
  --file lib/worktree-management.test.mjs \
  --file app/api/worktrees/manage/route.test.mjs \
  --file components/SessionSidebar.worktree.test.mjs

# Common baseline; includes core tests, typegen, typecheck and lint.
nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs

# Existing separately discovered plugin tests, including new adapter regressions.
nix develop --offline --no-write-lock-file -c sh -c \
  'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test "plugins/**/*.test.mjs"'

# New focused selection, after wiring/documenting it.
nix develop --offline --no-write-lock-file .#test -c env \
  E2E_WORKTREE_MANAGER_ONLY=1 npm run test:e2e

# General and existing plugin/browser acceptance remain separate.
nix develop --offline --no-write-lock-file .#test -c npm run test:e2e
nix develop --offline --no-write-lock-file .#test -c env \
  E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e
```

If terminal admission/observers or shared terminal/browser harness code changes, also run `nix develop --offline --no-write-lock-file .#test -c npm run test:terminal`. Pure reuse still needs the focused busy-terminal cleanup regression, not a claim of full terminal acceptance. Linux path-contract tests are not native Windows/UNC acceptance; simulated mount refusal is not actual bind-mount evidence. Report scopes honestly; no implicit privileged fixture setup. Do not redundantly run the ordinary npm baseline after the full offline pipeline. Never run `next build`/`npm run build`. Missing cached prerequisites are a reported blocker, not permission to alter dependencies or widen access.

All deletion tests use disposable harness repositories, never the accumulated real worktrees. Browser acceptance uses exported snapshots/free ports and leaves the installed 30141 service untouched. Retain exact failure diagnostics and follow current-run retention rules in `docs/testing.md` and `e2e/README.md`.

## Risks and Rollback / Recovery

- **Historical ambiguity:** containment is provable for current tips; a branch's name, fast-forward observation time and true wall-clock modification date are not universally recoverable. Keep evidence labels/unknown reasons visible.
- **New no-chat execution boundary:** biggest architectural addition. Resolve durable ownership/approval/review access before exposing any cleanup button. A bare call to `performCleanup` is not acceptable.
- **Performance:** many worktrees and deep history make status/date reads expensive. Progressive paging and cancellation are required; discovery failures must not masquerade as clean state. Measure disposable-fixture command runtimes during implementation, not during unrelated real-project deletion.
- **Irreversible effects:** deleting a worktree or local ref has no automatic rollback. Preserve completed/attempted-step records and remaining resources; never reconstruct deleted files from an assumed branch snapshot.
- **External races:** existing leases exclude only observed managed activity in this server. Do not advertise filesystem atomicity or OS-wide process exclusion.
- **Stored audit data:** standalone operation records and review bundles are private, versioned and retained without an automatic reaper. Disabling/removing the new surface must preserve evidence and never replay pending operations or migrate legacy Workflow data.
- Rollback of the feature means disabling the new capability/entry point and retaining records. It does not mean resetting refs, deleting resources, changing permissions, cleaning backups or altering session history.

## Completion Checklist

- [x] User approved this plan before source implementation started.
- [x] Manager opens from the project worktree menu without a chat or checkout change, and lists local branches plus registered worktree diagnostics.
- [x] Comparison defaults from existing designated-target settings when valid, allows explicit local alternatives, and never imports session policy or silently writes settings.
- [x] Containment/date evidence pass shallow/rewrite/fast-forward/revert fixtures; tip/merge dates never claim target-ref timing. Global date sorting covers matching rows with distinct loading/unavailable/not-applicable states.
- [x] Integration and source cleanliness/ignored content are visibly separate; unavailable/stale state cannot imply cleanup eligibility.
- [x] Plugin-disabled overview works; enabled cleanup respects project policy, one exact review, complete artifact authority and existing safety restrictions without a force fallback.
- [x] Worktree-only/branch-only/combined cleanup pass disposable tests; main/target/selected/active resources remain protected, idle chats warn but do not block, and unignored untracked files refuse manager cleanup.
- [x] Durable standalone reviews/outcomes survive reload; restart/partial/cancelled operations never replay and unknown results remain explicit.
- [x] Desktop/mobile, English messages, keyboard access, stale-response cancellation and required common/plugin/browser acceptance passed with recorded artifacts; conditional terminal evidence is resolved.
- [x] Owning guides/new ADR reflect delivered contracts, independent safety review is resolved and feature commits are reviewable.
- [ ] Exact-state local integration into `rst-main` is separately approved and verified, or its blocker is retained explicitly. Publication/deployment and feature-resource cleanup remain separately authorized.

## Historical pre-rebase implementation checkpoint — 2026-10-10

Delivered captured inventory/details, the generic no-chat operation host and Git
Workflow adapter, responsive localized manager, explicit exact confirmation under
Ask/Allow, durable historical reviews, and disposable backend/browser regressions.
ADR 0021 records the standalone boundary. Independent backend and frontend safety
reviews were completed; concrete findings were corrected and regression-tested.
The final read-only frontend review found no remaining blocking P1/P2 defect.

Browser corrections include retained preparation IDs/payloads, monotonic context
generations, reserved/generation-guarded history reads, project-wide operation
recovery, stale-capture refusal, resource normalization, focus restoration,
URL/cursor-owned review content, and whole-matching-set merge-date preparation
that preserves the last complete order. The sidebar lazily loads this optional UI.

### Executed evidence

Stable application input: export content/mode SHA-256
`c37aa04997550cabd9c61c03f136de2ee1dba1a77af6ec520010fb9aa27fbd9d`.
The offline runner's normalized inner export additionally records
`95cb7176bf24fa2ac7add40400c75c306f2e1a54350b592a948a8e1bc249a8f5`.
This evidence predates this status-only plan update; it is not a new-tip run.
Commands below use `nix develop --offline --no-write-lock-file .#test -c`.

| Selection/command after shell prefix | Result | Exact evidence | Runtime |
| --- | --- | --- | --- |
| `node nix/test-offline.mjs` | PASS: 272 files, 1,759 tests; typegen/typecheck/lint included | `/tmp/pi-web-test-offline.cRd57G0b/lifecycle.json`, `/tmp/pi-worktree-manager-full-core-2.log` | 160 s command wall |
| `sh -c 'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test "plugins/**/*.test.mjs"'` | PASS: 223 plugin integration tests | `/tmp/pi-worktree-manager-plugin.log` | 93 s command wall; TAP 90.6 s |
| `env E2E_WORKTREE_MANAGER_ONLY=1 npm run test:e2e` | PASS: desktop/mobile no-chat overview, recovery, global sorting after widening, stale-refresh refusal, delayed-history reservation, rejection, combined/branch cleanup and durable review | `test-results/e2e/browser-mtm2qa/run.json` | 213.6 s inner suite |
| `npm run test:e2e` | **FAIL:** manager flows passed at both sizes, later mobile archive/move context returned 409 | `test-results/e2e/browser-OvCBdS/run.json`, `context-12.zip`, `server.log`, `events.jsonl`, `lifecycle.json` | 597.7 s inner suite; enclosing tool hit 600 s |
| `env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` | PASS: desktop/mobile plugin cards, durable outcomes, cleanup, reviews/context, reject/reconnect/Stop | `test-results/e2e/browser-rrkJTp/run.json` | 397 s command wall; 391.5 s inner suite |
| `npm run test:terminal` | PASS: desktop/mobile real shell and lifecycle isolation | `test-results/e2e/terminal-8bD31x/run.json` | 50 s command wall; 44.3 s inner suite |

Focused-manager evidence used input
`4fe1cd39c1464fd1c5e94f0d365d8724afba204c9c351295709c10685cc7a546`
before the sidebar lazy-load change; the general run exercised that manager change
successfully but is not a passing general-acceptance certificate. Runtime excludes
model/review/coordination time; command wall includes shell/runner preparation,
while inner-suite times start after export/dependency copying.

The retained general-run trace corroborates exactly
`GET /api/sessions/e2e-archive-session/context?deferThinking=1&deferMedia=1&ancestorId=fe541311`
returning 409 with `{"error":"Branch changed"}` after the archive/restore flow and
before session movement. It is outside the manager surface; root cause/causality
is unresolved. No conflict/error suppression, unchanged retry, or application
deadline inflation was used. Inner teardown recorded settled resources; the
outer lifecycle was still running when the tool timed out, so its bulk remains
retained conservatively.

Earlier failures remain recorded: missing npm `typecheck` alias (corrected command),
focused browser named-select accessibility, relative download URL and mobile
sidebar fixture navigation, refresh-error masking, and the first full baseline's
Node CSS import failure (fixed by lazy-loading the optional manager). Their logs
are `/tmp/pi-worktree-manager-ui-check.log`,
`/tmp/pi-worktree-manager-browser-{1,2,3,5}.log` and
`/tmp/pi-worktree-manager-full-core.log`; artifacts are retained. Successful
replacements are scoped above, not claimed to erase those failures.

**Pre-rebase acceptance/integration blocker:** general browser acceptance had not passed.
Retain the feature branch/worktree; no rebase, integration, deployment, remote
operation or real accumulated-resource cleanup has occurred. The unchecked
acceptance/completion items remain open, not silently waived.

**Known gaps at that checkpoint:** general browser's archive-context conflict was
unresolved; no native Windows/UNC or privileged mount acceptance was run. Recorded
Git commit dates cannot establish exact historical target-ref integration times.

## Post-rebase acceptance checkpoint — 2026-10-10

Rebased implementation/adaptation candidate:
`a5659171ec2012642c2ded40beac83ac1df3ffb6`, based on current local `rst-main`
`3f1bce8af835c9acb01f62a8a5b70854cbfe6df3`. Fresh browser source export:
`cc9e7691b293d939a4d0edeeead5468f0a3275d78dd2af7ea554481dbe262cca`.
All requested selections ran again after the rebase. The general suite passed,
including both session-launch/manager flows and mobile archive/restore/move;
the earlier archive-context failure did not recur. This is not a claim that
manager changes caused or fixed that historical failure.

The first fresh terminal run failed during its intentional whole-browser offline
phase: `terminal-ZAX5NJ/events.jsonl` records an unrelated
`GET /api/agent/running` failing `net::ERR_INTERNET_DISCONNECTED` at
`2026-10-10T15:52:20.506Z`, followed by the strict console assertion failure.
Evidence remains in `test-results/e2e/terminal-ZAX5NJ` and
`/tmp/pi-worktree-manager-rebased-terminal.log` (46 s command wall).

Commit `c3ee2ad34a7b9478e938f3695f0215224391e76d` replaces only that fixture's
browser-wide outage with controlled EOF of one forwarded **actual terminal SSE
stream**. Native EventSource retry is held until the connecting UI is observed,
then continues unchanged to the actual backend. Real shell/PID, exact output and
no-replay assertions remain; console/5xx safeguards and application deadlines
are unchanged. This is stream-retry coverage, not whole-browser offline coverage.
Owned listener cleanup now survives browser-unroute failure, with an executed
real-listener regression. The independent review's P2 cleanup finding was fixed;
its follow-up found no blocking residual. The separate rebase-interaction review
found no blocking regression in launch admission, reservations, generic hosting
or combined browser wiring. Reviews were static/read-only, not runtime evidence.

Final source export before this evidence-only update:
`cb412b53b1d3c849f5ff9dde9eb80ee8aca44911f490212fb70256ca37340b35`;
offline normalized inner export:
`b20f98aab2d8d50a79e8d85e7e84057c78525671c4832d66da4f92d22b4fdb55`.
The only changes after `a5659171` are the terminal-only fixture, its unit tests,
and its focused guide. Application, plugin, general/focused browser modules and
shared harness inputs are unchanged, so earlier fresh browser/plugin passes
remain applicable; they are not relabeled as executions on `c3ee2ad3` or this
subsequent evidence commit. The full common pipeline and terminal acceptance
were repeated after the final fixture correction.

Commands use `nix develop --offline --no-write-lock-file .#test -c`.
All successful browser/terminal runs below recorded empty errors and settled
resources; their current-run bulk was removed by the normal bounded launcher.

| Selection/command after shell prefix | Fresh result | Exact evidence | Runtime |
| --- | --- | --- | --- |
| `node nix/test-offline.mjs` | PASS: 278 files, 1,786 tests, complete coverage; typegen/typecheck/lint included | `/tmp/pi-worktree-manager-rebased-core-3.log`, `/tmp/pi-web-test-offline.8Ztakyvb/lifecycle.json` | 152 s command wall |
| `sh -c 'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test "plugins/**/*.test.mjs"'` | PASS: 238 tests, no failures/skips | `/tmp/pi-worktree-manager-rebased-plugin.log` | 88 s command wall; TAP 85.7 s |
| `env E2E_WORKTREE_MANAGER_ONLY=1 npm run test:e2e` | PASS: 1280px/390px | `test-results/e2e/browser-tkL21r/run.json`, `/tmp/pi-worktree-manager-rebased-manager-browser.log` | 182 s command wall; 178.0 s inner suite |
| `npm run test:e2e` | PASS: full general suite including manager, session launch and archive/move | `test-results/e2e/browser-EFkhDH/run.json`, `/tmp/pi-worktree-manager-rebased-general-browser.log` | 709 s command wall; 704.4 s inner suite |
| `env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` | PASS: 1280px/390px | `test-results/e2e/browser-IB0Jd2/run.json`, `/tmp/pi-worktree-manager-rebased-plugin-browser.log` | 380 s command wall; 374.6 s inner suite |
| `npm run test:terminal` | PASS: 1440px/390px, final scoped-EOF fixture and teardown correction | `test-results/e2e/terminal-gbbiId/run.json`, `/tmp/pi-worktree-manager-rebased-terminal-4.log` | 54 s command wall; 47.3 s inner suite |

The first fresh common run additionally passed 277 files/1,783 tests at
`a5659171` (`/tmp/pi-worktree-manager-rebased-core.log`, 142 s command wall).
Intermediate fixture passes remain recorded in
`/tmp/pi-worktree-manager-rebased-core-2.log` and
`/tmp/pi-worktree-manager-rebased-terminal-{2,3}.log`; they are not substitutes
for the final corrected-input runs above. Runtime excludes model/review/
coordination; command wall includes preparation, while browser/terminal inner
suite times begin after export/dependency copying.

**Current handoff:** application acceptance is complete. This evidence/status
update needs proportional documentation review and unchanged-input confirmation,
not another application acceptance loop. Exact-state unsigned non-FF integration
into local `rst-main` still requires separate approval and execution verification.
No integration, remote publication, deployment, installed-service changes or
real accumulated-resource cleanup has occurred at this checkpoint. Retain the
feature resources until separately authorized cleanup; retain the pre-rebase
backup independently. The plan remains active until its integration handoff.

**Known gaps:** no native Windows/UNC or privileged-mount acceptance was run.
Recorded commit dates do not prove exact historical target-ref integration times.
