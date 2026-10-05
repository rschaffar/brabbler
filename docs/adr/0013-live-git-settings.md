# 0013 — Live Git settings without persistent tasks

> Historical decision: superseded by [ADR 0014](0014-remove-managed-git-workflow.md). Managed Workflow is removed; this document does not define current runtime behavior.

## Status

Accepted direction, 2026-10-04; implementation and acceptance remain in Phase 7 of the [sole workflow plan](../plans/2026-09-29_policy-driven-git-tools-plan.md). The user authorized removing the redundant task layer and explicitly chose **Use today’s saved settings**, rather than converting captured task choices into chat overrides.

This supersedes captured-task configuration, task Apply/adoption, duplicate early preferences and automatic worktree/chat continuation in ADRs [0007](0007-session-git-workflow.md), [0010](0010-integrated-git-workflow.md) and [0011](0011-policy-driven-git-tools.md). It does not supersede [ADR 0012](0012-optimistic-git-invocations.md), independent authorization, required checks or stronger repository instructions. A design decision is not deployment or acceptance evidence.

## Decision

### One settings hierarchy

New invocations resolve **Global → canonical Project → Chat×Project** settings. Omitted resource selection means the actual chat checkout; an explicit selection names physical registered resources. Neither editor selection nor a previous operation retargets another operation or moves the chat.

Captured task base, target, check, confirmation and enablement choices cease governing new invocations. They are not silently converted into another persistent override layer. Existing explicit settings overrides, opt-outs, action Deny and applicable Off/Manual restrictions remain. Unqualified old preferences must not spread branch names, recipes or positive confirmation consent across projects. Existing caller-wide overrides remain explicitly editable/resettable without introducing new fields; new chat preferences require an inferred or selected canonical Project. A non-Git chat can still opt out without selecting a Project. This compatibility path is not a new unqualified settings layer. Current saved Project recipes and applicable repository instructions determine verification requirements. Historical task and action records remain history, not grants.

Save changes subsequent invocations. It does not start Git, apply a task, update an existing candidate or schedule another stage. A pending operation retains its original relevant authority; a relevant save invalidates it at the existing safe boundary. Unrelated session/project edits remain neutral. No automatic retry or rebaseline follows a settings change.

### Settings are separate from transcript persistence and consent

Store mutable chat settings in bounded private settings storage, with editor CAS, genuine persisted-session/file identity and relevant monotonic authority publication. Normal streaming appends are not an identity change. Active-chat saves must not append through a second SDK session writer or weaken real move/fork serialization.

Creation provenance remains independent of mutable policy. Old, copied, forked, reopened or recaptured chats cannot acquire confirmation-free commit eligibility from a save, reset, restored record or today's defaults. Preserve the existing strict ordinary-creation proof, revocation and downgrade protections. A saved Allow, confirmation preference, exact approval and required-check evidence remain distinct.

New session creation records identity/provenance, not a copy of policy defaults. Its original-manager publication awaits the first pre-model SDK context boundary after persistence; SDK 1.0.0's `before_agent_start` precedes first-user persistence and is too early. Optional publication failure retires the original publication capability without retrying or aborting ordinary chat; the current process stays ineligible. A late storage failure is not a crash-atomic rollback guarantee. The proof binds the first trusted materialized-file observation, not an unavailable SDK creation descriptor or continuous filesystem monitoring. Explicit fork/recreation/move handling carries applicable preferences and opt-out restrictions, never grants, pending capabilities or fresh-origin eligibility.

A narrowly authenticated absent→published-wrapper conflict may permit one wholly fresh settings GET, never rehabilitate its failed original context. Original file/header/history and physical selection continuity remain constraints, not transferable CAS or native authority. This adds no startup wait or write/operation retry. The [maintained guide](../git-workflow.md#bounded-settings-metadata-reload) owns the bounded proof and refusal rules; focused source re-review is complete with the early-header P2 closed. Browser/full acceptance remain pending; scoped implementation results do not establish general cold-start or installed acceptance.

### One operation model, genuine actors

Agent mutation entry points use the selected native operation contracts, including deliberate omission-to-chat-checkout requests. Retire legacy task-dependent execution, early-preference writers, inline execution recipes and the worktree-start/navigation bridge. Native exact candidate capture and approval remain internal requirements, not a legacy agent preview/confirm protocol.

Browser routes reuse the same policy/native boundaries with a genuine human adapter. Human actions must not fabricate an agent tool selection, transcript request or saved Allow. Preserve eligible Chat-only/read-only human actions and Manual-versus-Off semantics. Read-only comparison accepts an explicit local target branch without requiring mutation eligibility or a checked-out target. Integration uses the canonical selected Project's configured target; its method resolves Global → canonical selected Project → this Chat×selected Project. Selecting B from an A chat uses B's hierarchy, not A's positive method preference. Target, main branch and required checks remain Project-owned, and stronger repository instructions—including non-FF requirements—still apply. The separately approved exact physical plan captures the method and candidate; neither a comparison selection nor later settings can retarget that approval. Relevant monotonic changes, including change-and-restore, revoke original authority rather than refreshing it.

Modern saved recipes retain cwd, literal environment, stage and ordered-batch semantics. Commit working-workspace evidence remains distinct from clean-source integration evidence; neither proves that the selected commit tree was tested. Checks and commit/integration approvals remain separate, even when no configured recipe is required. No checks are invented, dropped, sorted into a new cohort or replaced by old successes. Completed check evidence retains its original owner, scoped authority and cohort provenance after its tool call finishes; consuming it still needs a new independently authorized invocation. Ending a completed call does not revive a failed or cancelled cohort or preserve an execution grant.

### A smaller interface

Workflow shows scoped live settings, origins/reset, action permissions, checks, explicit operation resources and history. Remove captured-task comparisons/status, task Apply, adoption/release, duplicate preference forms and queued unsent-chat overrides. Keep settings-proposal **Apply/Dismiss**, which approves an actual settings change, and optional manual session Continue/Fork/Move utilities. Remove automatic Git-triggered chat relocation.

Retired write endpoints fail explicitly; they do not reconstruct old consent or mutate historical data. Shared private-I/O and scoped-authority helpers survive removal of the task orchestration that originally housed them.

## Consequences and boundaries

There is no recurring setup ceremony or enduring settings snapshot to refresh. This is an explicit change to which configuration new operations use, not a migration of action grants. Physical identity, original process-private capabilities, exact staging, native locks/CAS, honest partial/unknown outcomes, required receipts and rebase-result reentry remain mandatory.

The SDK/session-file privacy mismatch found during this work is separate: a genuine SDK 1.0.0 session created under umask `0022` has mode `0644` and fails the selected runtime's private-owner check, while `0600` succeeds. That reproduction does not establish the actual live incident's predicate. Do not fix availability by weakening owner validation, changing global umask or chmodding live files. Bounded diagnostics and production-wiring tests must make the supported/refused cases clear.

Development uses disposable settings, sessions and repositories. No live data migration, installed-service change, production build, global/Nix policy edit, integration, cleanup or remote publication is implied. Source verification and any later exact-state lifecycle approval remain separate.
