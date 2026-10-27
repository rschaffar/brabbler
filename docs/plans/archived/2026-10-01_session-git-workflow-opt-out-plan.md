# Per-chat Pi Web Git workflow opt-out

## Disposition — retired with historically incomplete verification (2026-10-27)

Historical integration `d8771e1` is on audited main. Managed-Workflow removal
retired this escape hatch. [ADR 0014](../../adr/0014-remove-managed-git-workflow.md)
is the explicit owner retiring every unmet browser/race/eviction/selected-project/
re-enable/quarantine obligation below, not claiming those checks passed. Current
optional plugin settings are not evidence that the old feature was completed.
The original unchecked tasks and failed checks remain historical, not an active queue.

## Goal

Let the operator turn off Pi Web's integrated Git workflow for one persisted chat, including an already-created chat, without confusing it with scoped enablement or Pause. Re-enabling restores the captured task; neither transition disposes of admission evidence or authorizes a Git operation.

## Plan Relationship

The historical integrated-workflow plan is superseded by `2026-09-29_policy-driven-git-tools-plan.md`. This bounded opt-out owns only the chat-level escape hatch and its compatibility path, not recovery of a failed check or general policy automation.

## Plan

- [x] Add a backward-compatible persisted chat opt-out and fork inheritance in `lib/git-workflow-session.ts`/`lib/git-workflow-policy.ts`; legacy, malformed, fork and round-trip cases pass in `lib/git-workflow-settings.test.mjs`.
- [ ] Expose a revision-checked, idle-only per-chat toggle through `/api/git/workflow/settings` and Workflow home; stale edits, invalid input and explicit-project rejection pass in route tests. Browser and in-flight run race coverage remain open.
- [ ] Make live guidance disappear when opted out, and refuse chat-bound Pi Web managed Git mutations (including selected-project commits) at dispatch and apply. Prompt/permission tests and route suites pass; wrapper eviction and selected-project agent end-to-end tests remain open. Sidebar worktree actions are project-scoped rather than chat-bound.
- [ ] Preserve check-quarantine evidence and the recovery-only policy reader; recovery and read-only review use captured policy. The existing recovery suite's corrupted-proof case fails identically on unmodified `rst-main`; direct re-enable/admission regression is still open.
- [ ] Document the distinction from Pause and inherited Off in `docs/git-workflow.md`; focused tests (105/105) and lint pass. `npm test`: 1951/1962 pass, 5 skipped, 6 fail (one baseline recovery, five missing `@pierre/diffs` dependency in the reused checkout's node_modules); `tsc --noEmit` reports seven errors from that same missing dependency. Focused E2E attempted but its dev server exited: Turbopack refuses this worktree's temporary symlinked `node_modules` outside its filesystem root. Browser E2E remains open; no production build.

## Non-Goals

- Clearing or rewriting an unresolved Git operation, waiving repository/user instructions, changing other chats, or approving a remote operation.
- Hiding user/third-party extensions or changing external tool installations. The idle wrapper is evicted on toggle; a new wrapper omits Pi Web Git extensions, while stale calls still fail closed.

## Rollback / Recovery

The opt-out is a reversible session entry, not a change to Git state. The old admission journal and its recovery path remain intact. A return to the managed workflow must enforce the old admission guard again.

## Completion Checklist

- [ ] A user can toggle one idle persisted chat Off/On and see its actual effective state, with no Global/Project override restoring managed actions while opted out.
- [ ] Fresh runs in that chat receive no Pi Web Git guidance while Off; loaded managed mutation tools do not execute.
- [ ] The original quarantine remains recorded and blocks managed Git execution when the chat is switched back On.
- [ ] Required checks and feature history are reviewable; integration needs separate exact-state approval.
