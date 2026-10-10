# Agent-created ordinary sessions

## Goal

Implement the user-approved launch contract: a fresh ordinary session, independent runtime and initial prompt, creator-setting defaults with explicit proposed changes, Deny/Ask/Allow at global/project/session scope, exact approval with request-changes feedback, and navigation links both ways. Implementation is authorized; integration and cleanup retain their separate gates.

Worktree: `feat/session-launch`, `../pi-web-worktrees/session-launch`, base `6e337e5681c187c13e65b87cbcc7a2cde8d3d000` (local `rst-main`).

## Plan Relationship

Build on generic bundled-plugin settings, interaction cards and operation receipts. Do not change Git semantics, fork history, subagent lifecycle or unrelated active plans.

## Architecture

- Bundled Session Launch plugin exposes `start_session` only to ordinary coding sessions. Default enabled, launch permission Ask. Guidance requires an explicit user-requested launch even under Allow; this is not natural-language intent enforcement or an OS sandbox.
- Reuse generic private settings, live registration and execution receipts. Destination project determines policy; creator session overrides apply only to its own project. Non-Git destinations use their canonical directory identity.
- Snapshot and validate effective initial settings before approval; revalidate policy and destination before dispatch. No settings-writing tools or copied session overrides.
- Ordinary startup/prompt acceptance owns execution. Persist creator metadata by stable IDs, not parent-file paths or subagent relationships. Metadata includes the created session ID to avoid accidental attribution on forks/clones. Preserve truthful partial outcomes if startup/prompt acceptance/receipt persistence fails.
- Generic cards gain optional additional-details support; Request changes returns feedback without launch. Historic cards remain read-only.

## Non-Goals

Copied conversation history, creator completion notifications, subagent or Chat-only launch access, remote actions, installation/service activation, production builds.

## Plan

- [x] Implement generic card feedback and safe navigation-link presentation; verify validation and receipt tests.
- [x] Implement scoped launch settings, exact launch validation, ordinary runtime creation and durable outcomes; verify focused permission/startup regressions.
- [x] Persist and display creator metadata and bidirectional navigation independently of fork/subagent trees; verify scanner and UI/browser regressions.
- [x] Update maintained guides and add browser/SDK fixtures for Ask/Allow, feedback, independent runs and reload.
- [x] Obtain independent safety review and address findings with focused tests.
- [ ] Run stable-candidate full offline baseline and affected browser/plugin acceptance, recording input identity, command, result, runtime and artifact paths.
- [ ] Commit reviewed changes and resolve completion intent; rebase/verify and obtain exact-state integration approval if integrating.

## Verification / Review (in progress)

- Safety review is read-only and independent. Addressed late admission/configuration changes, command/template expansion, shell normalization, SDK early deferred resolution and destination-trust scope discrepancies. Guarded deferred submissions fail closed rather than being certified from the compatibility fallback. Final follow-up found no remaining blockers in those fixes (source-only; not independent acceptance execution).
- SDK acceptance: `nix develop --offline --no-write-lock-file -c sh -c 'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test --test-concurrency=1 plugins/session-launch/runtime.test.mjs'`; **15 passed**, Node runtime **3.10 s**, `/tmp/pi-session-launch-sdk-5.log`. Includes real model-issued tool calls, child independent questions, reload, cancellation through SDK hooks, exact literal prompts/configuration, trust and incomplete subagent metadata.
- Focused offline static preparation + four files: `nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs --file lib/session-launch-admission.test.mjs --file lib/session-launch.test.mjs --file lib/session-spawn.test.mjs --file lib/plugin-card-details.test.mjs`; **17 passed**, typegen/typecheck/lint passed. Not full acceptance. Log `/tmp/pi-session-launch-focused-4.log`, evidence `/tmp/pi-web-test-offline.mZV0wW7g`, original source digest `4cc0028f54c223bd00cf03813c01ee41a49e2835990bc17a2ab8c186d7087d9b` (pipeline overlay digest `9091cb09c774760f33787bf7f4bc16482d2791ec6cb3f3e605182fc7b05555a6`).
- Focused browser: `nix develop --offline --no-write-lock-file .#test -c env E2E_SESSION_LAUNCH_ONLY=1 npm run test:e2e`; **desktop 1280px and mobile 390px passed**, `/tmp/pi-session-launch-browser-7.log`, `test-results/e2e/browser-NnLtQq/run.json`, source digest `dcd61537fa07acc95ed5898e7951c08b2840658c5c4811abb5fda73505ad7546`. This preceded the malformed-subagent guard/test follow-up; full stable-candidate browser verification remains pending.
- Failed iterations retained: SDK fixture API typo (corrected before SDK-5); browser fixture selectors/import boundary/scope and wrong running-response field (corrected before browser-7). `/tmp/pi-session-launch-sdk-4.log` and `/tmp/pi-session-launch-browser-{1..6}.log` preserve failure evidence; no unchanged retry is claimed as a fix.
- Full common baseline: `nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs`; **272 files / 1,751 tests passed**, typegen/typecheck/lint passed. Log `/tmp/pi-session-launch-full-3.log`; evidence `/tmp/pi-web-test-offline.3V3iv4il/artifacts/run-LR2yML`, original source digest `484e873903fb40be65e8e3cbaefa9f848903785e57ef667d1c768c3708a762b3` (pipeline overlay `a1dd3af9fb399d3bfd4d580796c25b5972b0b7f73667a715c14fdf803907f0d8`). Command wall time including cached shell entry **135 s**; lifecycle execution **130.0 s**, distinct from model work/review/coordination. Earlier full runs retained `/tmp/pi-session-launch-full-{1,2}.log`: corrected non-directory-plugin error-message compatibility and updated source-shape assertions for the host observer/guard, without weakening semantic checks.
- General browser acceptance and affected Git-plugin regression remain pending. Local `rst-main` advanced with the English-only interface feature during this task; integration requires a rebase and resulting-candidate verification. No production build, installed-service activation, remote operation or cleanup of historical diagnostics is authorized.

## Rollback / Recovery

Settings and custom entries are additive and private. Revert hides metadata/receipts without deleting sessions. Cancelling or requesting changes starts nothing; a session already created is retained on prompt failure and reported by ID. No rollback deletion, restart replay or historical launch authority.

## Completion Checklist

- [x] Fresh sessions run independently with exact approved prompts and fail-closed model/account bindings.
- [x] Policy scopes, foreign destinations and live changes do not leak creator overrides or authorize stale proposals.
- [x] Request-changes feedback never launches; Ask/Allow leave honest durable outcomes.
- [x] Ordinary sidebar entries and durable links work after reload; forks/clones do not inherit creator attribution.
- [ ] Required verification and review completed, or blocked evidence explicitly retained.
- [ ] Feature lifecycle and retained resources reported; no remote operation or service activation inferred.
