# Per-session ChatGPT model speed

## Goal

Add only **Standard** and **Fast** beside Thinking for ChatGPT/Codex subscription sessions. Start fresh and legacy sessions at Standard, persist the selected speed per session, and never change reasoning depth or global/browser startup defaults.

## Context

The approved branch `feat/session-model-speed` starts from local `rst-main` at `9c0f92b895cd708db73b20bb6a2a1e214458e64f` in a dedicated linked worktree. Its declared and hydrated Pi SDK dependencies are 1.0.0. That SDK exposes `serviceTier` through full streaming options but drops it in `streamSimple`; payload-only injection also loses requested-tier information used by Codex cost accounting.

## Plan Relationship

The SDK-upgrade plan owns dependency versions, and the multiple-provider-accounts plan owns credential selection. This feature changes neither. Preserve the session-bound runtime/account boundary and the existing tool-selection, exact-prompt and extension behaviors.

## Architecture

- Browser-safe speed values are `standard` and `fast`. Store append-only version-1 `pi-web:model-speed` custom entries outside model context. The latest valid entry across the whole session wins; missing/invalid entries mean Standard. Speed is session-wide, not branch-local.
- Return speed in disk session reads and live `get_state`. An idle-only `set_model_speed` command changes only that session. Creation accepts an independent `modelSpeed` override. Forks, clones, subagents and transient wrapper recreation explicitly retain/inherit the value even when copied branch history predates it.
- Support the pinned SDK's native `openai-codex` / `openai-codex-responses` subscription path only. Hide the picker for other providers, retain its stored preference when models change, and do not add request fields to unsupported providers.
- Use a session-local runtime view, not mutation of a shared runtime: subagents share account/auth services but must not share a mutable speed setting. Only matching session chat streams use Standard → `default` or Fast → `priority`. Preserve reasoning, token clamping, request/header hooks and account isolation. Auxiliary calls keep their existing settings. Conflicting payload-tier hooks fail instead of sending a differently priced request.
- Keep native SDK cost estimation. Correct only an explicitly observed legacy Codex `fast` response tier by recomputing base catalog costs before the priority multiplier, never multiplying an already-adjusted estimate. Displayed dollars remain catalog estimates, not subscription quota charges, and selected speed is request intent rather than delivered-tier proof.
- Add a compact accessible native select beside Thinking, translated in all three current languages. Disable changes while running/compacting/switching; explain higher subscription usage and provider/model availability.

## Non-Goals

Ultrafast, arbitrary speed sliders, API-key service-tier controls, global speed defaults, new account authorization, provider catalog refresh, SDK upgrades, production builds, remote publication, and automatic integration/cleanup.

## Unknowns / Risks

No live account entitlement or delivered speed will be verified: validation is offline and browser fixtures must not make paid model calls. Provider rejection must remain visible; do not silently downgrade Fast. The SDK-specific adapter/accounting behavior needs mocked regression coverage and should be reviewed on a future SDK upgrade.

Read-only review also noted a pre-existing transient tool-recreation account-snapshot omission. It is unchanged by this feature; correcting it is separate provider-account work, not speed implementation.

## Rollback / Recovery

Metadata is additive and ignored by older clients. Removing the feature leaves prior conversation content and credentials untouched; do not delete or rewrite users' session files for rollback. Retain the feature branch/worktree on any verification or integration blocker.

## Plan

- [x] Add validated speed values and session-entry persistence; test legacy, malformed, latest-valid and branch-independent reads.
- [x] Add the session-local SDK adapter and honest cost handling; verify independent reasoning, unchanged other providers/hooks/accounts, parent/child isolation and response tiers using offline fixtures.
- [x] Wire creation, RPC state/setter, disk reads and all session-copy/recreation paths; verify persistence, idle-only changes, fork/clone/subagent inheritance and transient preservation.
- [x] Add translated desktop/mobile composer controls; verify exactly two choices, fresh-session Standard, per-session persistence/isolation, higher-usage warning and disabled/unavailable states in browser acceptance.
- [x] Document current behavior and SDK compatibility in maintained guides; review the diff and record verification evidence here.

## Verification evidence

- Original focused acceptance passed 10 files / 95 tests, plus type generation, typecheck and lint. Review reopened ambiguous-save, shutdown and auxiliary-isolation behavior rather than treating that pass as completion.
- Post-review focused offline acceptance passed 9 files / 72 tests with typecheck/lint (`nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs` with repeated `--file` selections; `/tmp/pi-model-speed-recovery-focused.LFBdZ6.log`). This includes production-callback tests for stale reads, wrapper IDs, bounded requests, polling/online/visibility and unmount, plus real SDK main/warming/bug-summary and delayed-shutdown lifecycle coverage. Do not add overlapping focused counts.
- Focused browser acceptance passed 1280×800 and 390×844, including new contexts and lost-acknowledgement/reconnection regressions (`nix develop --offline --no-write-lock-file -c env E2E_MODEL_SPEED_ONLY=1 npm run test:e2e`; `/tmp/pi-model-speed-review-browser.KBlgRj.log`). All writes are real; provider responses/credentials are synthetic. No paid requests.
- The first full core attempt exposed an outdated extracted warm-cache fixture (`modelSpeedRef` missing), now repaired. Full offline acceptance subsequently passed 245 files / 1,590 tests, plus 29 exporter contracts, type generation, typecheck and lint (`nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`; `/tmp/pi-model-speed-full-core.yWLDJS.log`). The final post-fixture rerun passed the same counts and checks (`/tmp/pi-model-speed-final-core.0PcqDi.log`).
- Full browser acceptance passed at both widths (`nix develop --offline --no-write-lock-file -c npm run test:e2e`; `/tmp/pi-model-speed-full-browser.1OQdCH.log`). Earlier attempts exposed missing usage on synthetic post-compaction assistants and a clipped sidebar-label click; fixtures now provide zero usage and click the actual row. Failed traces/logs are retained. The stalled-read scenario now checks immediate signal cancellation on `online`, not merely eventual timeout/poll recovery.
- Follow-up read-only UI/server reviews found no substantive remaining speed regression; the ambiguous-save, shutdown and SDK-auxiliary findings are resolved and covered.
- After rebasing onto local `rst-main` at `67b133d9c046c834c443bba757d336890aae6649`, exact feature checkpoint `06808d8334f7b2772f0052033e86f1f7e91fcf0e` passed 253 files / 1,624 tests (no failures/skips), 29 exporter contracts, type generation, typecheck and lint (`nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`; `/tmp/pi-model-speed-rebased-core.e7peZ1.log`). Full desktop/mobile browser acceptance passed on the same clean checkpoint (`nix develop --offline --no-write-lock-file -c npm run test:e2e`; `/tmp/pi-model-speed-rebased-browser.PzCWVv.log`).
- Rebase conflicts were documentation-only. Keep both test guides and the current Pi Desk README, adding the speed guide under its model/account features. Original and intermediate feature commits are retained on timestamped local backup branches. No remote, production build, live credential access or paid model request occurred.

## Completion Checklist

- [x] Focused affected Node tests pass in the offline Nix environment.
- [x] Full `npm test` coverage, `node_modules/.bin/tsc --noEmit` and `npm run lint` pass using the repository's isolated offline runner.
- [x] Focused and full `npm run test:e2e` pass without paid provider calls; terminal tests are not applicable because no terminal integration changed.
- [x] Create a reviewable unsigned feature commit and verify its exact tip at the checkpoint above.

## Local integration handoff

Implementation is complete; archiving this plan records acceptance, not integration. The global `git-worktrees` skill and the repository Git profile in `AGENTS.md` own the remaining lifecycle: obtain separate exact-state approval before any unsigned non-fast-forward integration into current local `rst-main`, and keep publication and cleanup separately approved. The subsequent archive/evidence commit changes only this plan; review that documentation delta and confirm application/test inputs remain identical to the tested checkpoint rather than rerunning application acceptance solely to record it.
