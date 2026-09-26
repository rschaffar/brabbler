# Session Git workflow

## Goal

Let a user choose a project's default Git workflow and override it per chat, so agents can work in the intended checkout, make reviewable feature commits, and prepare a local integration without repeatedly asking for choices. A saved preference never approves an unseen integration, cleanup, or remote operation.

## Plan Relationship

This plan owns Git workflow policy and checkout changes, not the provider-account default/binding in `2026-09-25_multi-provider-accounts-plan.md`, session archive in `2026-10-18_session-archive-plan.md`, or browser `ask_user` in `2026-09-25_browser-ask-user-plan.md`. Reuse their session metadata, idle-wrapper, and browser interaction patterns without changing their ownership.

## Architecture

A versioned, validated workflow policy has a project default (private Pi Web data, keyed by canonical Git project root) and a per-session snapshot/override (a namespaced Pi session custom entry). Absent policy preserves today's behavior. The project default applies only to **new** sessions, never silently changes existing sessions. The session and agent Git tools read the same effective policy; the agent receives a short, current projection at the start of each new run. Changes while running take effect after settlement, not partway through a tool call. Chat-only retains its exact-prompt/resource boundary.

A Git workspace UI identifies the current chat's **real cwd** separately from the sidebar's selected cwd. Creation chooses an explicit local base; continuing an idle persisted chat into a linked worktree uses staged session-family relocation and reloads its wrapper, not a label. Forking preserves the source chat and sets the new session's cwd. Neither operation transports uncommitted files. Any subagent/fork metadata repair preserves history. Separately, an agent may explicitly create a new worktree from its saved policy, durably schedule the selected on-create action, and attempt it **once at that same run's idle settlement**. Claim a private receipt before clone/move; never replay it after a restart. A failed or abandoned transition requires manual recovery.

A shared server-side review/commit engine backs both browser and built-in agent operations. It requires explicit complete file paths and a bound preview of branch, HEAD, index, and selected tree; rejects stale candidates and unrelated staged work; has no remote side effects. No claim of fully atomic index/ref/worktree updates across other Git processes. A failure after ref advancement must report the commit as having succeeded and retain evidence for safe recovery. Supported Git hooks/signing/filter behavior must be explicit, not accidentally bypassed. Browser routes validate allowed roots and checkout identity; agent tools bind to the session's own cwd.

Verification, exact-state local integration, and worktree cleanup are distinct steps: saved target/method guide proposal generation, never constitute approval. An exact candidate review card, with check results, must precede integration. That card provides three diff scopes for an ordered series: whole proposed merge (resulting candidate tree against the captured target), one commit against its first parent, or a *contiguous* selection of commits (last selected tree against the first selected commit's first parent). A non-contiguous selection is not a range; rewrites, changed target, or changed candidate invalidate the approval. Cleanup and remote publication stay separate.

## Non-Goals

- Automatically approving an integration, deleting worktrees, or pushing because a default was saved.
- Guaranteeing that a tool policy constrains agents with unrestricted `bash` or external Pi CLI writers.
- Migrating uncommitted files when a chat changes checkout.
- Requiring the Linux-only external `git workflow` executable at runtime.

## Plan

- [x] Add session/project workflow policy schema, validation, precedence, persistence, and fork inheritance under `lib/`; unit tests verify defaults, override isolation, malformed data, and linked-worktree identity.
- [x] Make current workflow policy visible to the agent on its next run and to Git tools without a browser reload; test live edits, running-session deferral, restored sessions, and Chat-only isolation.
- [x] Add a new-chat setup and an editable session Workspace panel with effective source, current chat checkout, branch and worktree inventory; test selected checkout versus sidebar cwd and responsive flow.
- [x] Change worktree creation to an explicit local base and expected commit, with stale-base and branch-collision checks; test no silent remote-tracking selection.
- [x] Add idle same-project worktree continuation and an explicit fork alternative; test history, session/subagent path repair, active-run rejection, wrapper recreation, and uncommitted source files left intact.
- [x] Prototype the portable preview/commit Git transaction in disposable repositories, including linked worktrees, stale index/ref and post-ref-update failure; choose and document bounded Git hooks/signing/filter behavior before exposing it.
- [x] Expose the guarded preview/commit engine to the browser and a session-bound built-in agent tool; test file scope, tool availability, authorization, identity, and conflict/recovery reporting.
- [x] Add a read-only merge-review preview of the candidate tree against the target, per-commit diffs, and cumulative contiguous commit-range diffs; test ordered selection, whitespace/binary handling, stale proposal rejection, and that the whole-merge view includes the actual result rather than only feature-branch patch totals.
- [x] Add explicit local verification/proposal/integration with exact-state approval and independent cleanup confirmation; reject unsupported methods and retain recovery on partial failures.
- [x] Document UX, limits, recovery, and maintained architecture in `docs/worktrees.md`, `README.md`, `AGENTS.md`, and a decision record; update browser tests for the full flow.

## Risks

- Git cannot atomically change a worktree index, files, and a branch ref against arbitrary external writers. Never conceal a partial success or silently reset/stash a checkout.
- Relocation rewrites durable JSONL paths; coordinate wrapper shutdown, concurrent writes, session families, and rollback.
- Project instructions can be stricter than a selectable UI policy; present and honor stricter requirements rather than treating a default as an override.
- Tools that execute checks, hooks, filters, or remote operations cross different trust/authorization boundaries; no checks are run solely because an agent invented one.

## Rollback / Recovery

Policy storage and session custom entries are additive; legacy sessions remain unchanged. Retain both the transcript and original workspace on relocation failure and report recovery artifacts rather than discarding changes. A commit that advanced a ref remains a commit even if index reconciliation fails; show the resulting ID and require manual inspection. An integration that partially changed refs/files retains its feature worktree and recovery information; never automatically delete or force reset. Remove added UI/tool registrations to roll back, but do not erase user policy or Git commits automatically.

## Completion Checklist

- [x] New sessions honor project defaults and per-chat overrides; existing chats keep their snapshot, with next-run changes visible without a browser refresh.
- [x] Chats can continue or fork into a selected worktree without silently moving files or applying the policy to the wrong checkout.
- [x] Previewed selected changes can be committed by browser or agent; stale/partial changes fail closed and actual commit/author are reported.
- [x] Integration review shows a whole-result diff, an individual-commit diff, and a consecutive-range cumulative diff for the same exact candidate; integration and cleanup remain separately approved, with no implicit remote operations.
- [x] Run `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and browser E2E for the affected flows (never `next build` during development); Playwright's bundled browser lacked system libraries, so E2E used the available local Chrome.
- [ ] Review the exact feature candidate, rebase on current local `rst-main`, repeat required checks, and obtain exact-state approval before ordinary unsigned non-fast-forward local integration; request separate approval before cleanup.
