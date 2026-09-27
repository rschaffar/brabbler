# Agent-driven Git review and approvals

## Goal

Replace Pi Web's permanent Git footer panels with an agent-callable, repository-generic, structured conversation flow for early workflow choices and exact-state commit, merge, and cleanup review. The tool must perform only the individually approved local operations and reduce repeated question/command tokens without making saved preferences into approval.

## Plan Relationship

This supersedes the **interaction design**, not the protected Git operations, of `2026-09-26_session-git-workflow-plan.md` and ADR 0007. That plan's saved policy, actual checkout binding, commit, review, verification, and integration mechanics remain reusable. This plan owns the new agent surface, generic arguments, cleanup transaction, and removal of the fixed panels. A new ADR must explicitly revise the earlier UI decision.

## Architecture

- One session-bound Git tool offers discrete operations: choose/inspect early defaults, review candidate commits/merge/cleanup, run explicitly selected checks, and execute separately approved exact-state operations. Inputs for target, method, and checks are explicit or from a saved snapshot; a snapshot never approves a candidate. Read-only comparison also works without saved policy. All paths are bound to the session checkout and registered worktrees, not agent-invented arbitrary roots.
- Agent-invoked blocking requests use Pi Web's extension UI lifecycle (IDs, validation, cancellation, stop, expiry, SSE replay). A typed, transient chat card presents exact refs, tree identities, commits, bounded patches and changed paths. Approval is checked server-side and bound to an authenticated, revalidated candidate, not a free-form `ask_user` answer or a tool-call boolean.
- One approval handles only one operation. A merge does not approve cleanup, ignored-file deletion, verification commands, remotes, or publication. Early answers may record worktree mode, destination, integration method, checks, and post-integration retention preference; exact-state approval cannot be recorded early.
- Reuse existing guarded Git primitives where safe. Do not make the optional `git-workflow` CLI a Pi Web runtime dependency. Keep the old guarded endpoints functional until the replacement is exercised; remove their persistent in-chat entry points, moving manual settings into an on-demand settings action as appropriate.

## Non-Goals

- No automatic remote action, push, force cleanup, implicit rebase, or arbitrary shell-command authorization.
- No unattended approval based on project defaults or prior chats.
- No promise that in-process gating prevents external Git writers or that Windows behavior is tested.

## Plan

- [x] Establish a first vertical slice: a policy-independent `git_workflow` tool can show whole/range comparisons and request exact commit approval using a transient Git card; a collapsed top-row Git menu replaces three permanent footer rows. Evidence: `lib/agent-git-workflow-extension.test.mjs`, `lib/rpc-manager-extension-ui.test.mjs`, and typecheck. This slice deliberately does not execute merges or cleanup.
- [x] Add agent-triggered check authorization and a separately approved exact local merge without a saved policy; preserve state-bound receipts, target trust, registered checkout gates, cancellation and partial-state recovery. Evidence: 39 focused engine/UI tests, `tsc --noEmit`, lint; `lib/agent-git-workflow-extension.test.mjs` exercises a disposable repo.
- [x] Add typed early per-chat preferences for registered target, ordered checks, workspace intent and retention without authorizing an operation; validate forged/cancelled/stale replies and fork inheritance. Evidence: `lib/agent-git-workflow-extension.test.mjs`, `lib/rpc-manager-extension-ui.test.mjs`, typecheck and lint.
- [ ] Specify typed agent requests, response validation, candidate identity and operation-specific approval rules in `lib/`; test forged, cancelled, expired, and stale answers.
- [ ] Implement a transient Git card in the chat timeline with compact summary, expandable whole-result/commit/range diffs, check evidence, and distinct approve/decline controls; test SSE replay, stop, narrow screens, and stale requests.
- [ ] Register a session-bound Git tool available for ordinary non-Chat-only sessions; read-only status/review and early choices must not require a saved policy; test session binding and loadout.
- [ ] Connect commit preview/confirmation with the typed Git card and existing guarded engine, requiring a human approval of the exact candidate before execution; test changed paths/index/HEAD and partial success.
- [ ] Extend verification and local merge planning to explicit agent-supplied target/check choices without weakening registered-checkout, trust, policy, receipt, or exact-state safeguards; test refusal without separate verification and approval.
- [ ] Add an exact-inventory, revalidated cleanup proposal and separately approved removal of the named feature worktree and local branch, offering to relocate the idle originating chat to the target first, accounting for ignored files and other sessions bound to the checkout; test stale/dirty/locked resources and partial recovery.
- [ ] Remove permanent `GitCommitPanel`, `GitMergeReviewPanel`, and `GitWorkflowSettings` footer rows; expose remaining settings/manual controls only on demand and update `README.md`, `docs/git-workflow.md`, `AGENTS.md`, and a new ADR.
- [ ] Run focused tests followed by `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e` for the browser flow (no production build).

## Cleanup blocker (not implemented)

The checkout gate currently blocks running-session commands but not *new* session startup or concurrent `moveSessionFamily` calls; the session-list scanner can omit malformed files. A cleanup engine cannot prove zero bound sessions or exclude a writer with those admission/inventory gaps. Close them and test adversarial startup/move and malformed-session races before enabling checkout or branch deletion. Until then, only the existing manual worktree controls remain available; no agent cleanup is claimed.

## Risks

A tool result cannot itself authorize a future ref update; consent must attach to the inspected candidate and revalidate before mutation. A chat running inside a worktree cannot safely delete that checkout under its own feet; cleanup needs a separate server-owned transaction after the run settles. The user chose a separately reviewed move-to-target option; unrelated sessions in the old checkout still block removal. Verification commands may modify files and require explicit selection and trust. Retain partial-state records and resources for inspection, never auto-retry a failed ref/checkout operation.

## Rollback / Recovery

Preserve existing backend APIs during transition and retain private receipts on partial operations. If UI or tool registration fails, the legacy routes remain accessible for diagnosis, but never auto-execute a pending candidate. Cancelled dialogs cause no mutation. Retain any checkout/branch whose removal or ref update cannot be proven complete.

## Completion Checklist

- [ ] An agent in an ordinary session can request generic review without a prior project policy and display whole/single/range patches without permanent footer links.
- [ ] Exact commit/merge/cleanup each requires separate human confirmation bound to revalidated identities; early answers never count as execution approval.
- [ ] The recorded verification suite and affected browser flow pass on the exact feature tip; integration into `rst-main` requires separate exact-state approval.
