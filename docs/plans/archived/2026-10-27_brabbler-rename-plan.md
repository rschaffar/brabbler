# Brabbler rename

## Goal

Rename this independently maintained application from Pi Web/Pi Desk to Brabbler, including its current package, CLI, environment, storage/protocol namespaces, Nix interfaces, UI/demo and maintained documentation.

## Context

User authorized a clean breaking rename: unscoped `brabbler` package/CLI/Nix identity, Brabbler application-owned paths/metadata, and `BRABBLER_*` configuration. Pi-owned `.pi/` storage, native SDK/CLI interfaces and the existing π icon stay. No new repository URL is established; keep upstream attribution accurate and disable inherited release/update targeting. The existing `deployment.example.invalid` deployment URL is explicitly out of scope until a later migration. No legacy fallback or committed migration tool is wanted. A separately authorized disposable one-time migration can follow after the rename; this change does not read or modify live data. Existing Pi SDK interfaces and third-party names remain unchanged. Original upstream credit and genuine historical evidence remain accurate. No publication, remote changes, deployment or foreign NixOS changes are authorized here.

## Plan Relationship

The existing account, Claude CLI, Explorer and acceptance/performance plans retain their scopes. This plan owns only identity changes, not their deferred implementation or benchmarks. Historical plans, receipts and source/store/log paths are not rewritten as new Brabbler evidence.

## Plan

- [x] Rename package/CLI, application-owned configuration, storage and protocol namespaces, Nix packaging/service/test interfaces, source filenames and live test inventories together; source audit and live inventory show 525 classified tests without stale paths.
- [x] Update visible application/demo branding and maintained documentation; preserve original upstream/license attribution and historical evidence. Disable inherited upstream publication/update targeting rather than inventing a new remote identity; source review findings are addressed, including valid checkout-only demo commands.
- [x] Review the coherent source change for missed branding, security/environment-patch consistency, obsolete references and accidental third-party/history rewrites. Independent runtime/packaging review approved the corrected source; branding/doc findings were fixed and checked. Legacy secret denials are retained as security exclusions, not compatibility readers.
- [x] Run focused checks, then full Nix-native core/browser/deployment acceptance on the settled candidate; evidence below records the exact command, results, timings and artifact paths.
- [x] Commit the verified source as `2d7a34db16ab2cf35d4bdf4dcd626931c29fe04f`; user selected local `main` integration by unsigned non-fast-forward merge. Rebase found the candidate already current. Exact merge/cleanup approvals and execution receipts, not this source document, own final lifecycle outcomes.

## Verification checkpoint

An initial focused Nix core selection passed 157 tests in 10 files, plus genuine typegen/TypeScript/lint and 29 exporter contracts (`/tmp/brabbler-test-core.F67xEg/run.json`). That result predates the final notebook/browser-key, push-configuration-route and secret-exclusion changes and is not final-candidate acceptance. The SDK 1.4.0 patch helper/twelve module fingerprints were regenerated from recognized immutable cached SDK bytes; dependency versions and flake pins are unchanged. Both npm-cache hashes were updated from actual fixed-output mismatch results after package-identity changes. An offline attempt found three missing toolchain outputs; ordinary pinned substitution resolved them without changing pins. Full acceptance remains the gate below.

## Final source acceptance

- `nix run --no-write-lock-file .#test -- all --workers 4 --jobs 12`, exit 0, **467.988 seconds (7m48s)** end to end with warm pinned prerequisites. Resource admission observed 32 CPUs and approximately 48 GiB available; requested/effective widths were 12 core workers and four browser sandboxes. No deadlines, coverage or isolation rules changed.
- Source: `/nix/store/lbxw6ad8w5bm0w1ml06rpqvmhi6civ4k-source`, outer exported digest `704e867af6402752bcdc8e403610ae4365b58a1b814445dc3441031b0d7c41f0`.
- Core: **525 files / 4,309 tests / 14 suites**, zero failures/skips/cancellations, plus exporter contracts and typegen/TypeScript/lint. Receipt `/tmp/brabbler-test-core.zrI5Bj/run.json`; outer duration 355.108s.
- Browser/terminal: **26 groups / all 59 exact scenario receipts**, every expected/completed set matched and every group passed/settled. Receipt `/tmp/brabbler-test-browser.Thiv1F/run.json`; preparation 4.478s support + 6.952s definitions, outer duration 368.885s; capsule window 17:58:41.882–18:04:38.719 UTC. Core/browser intervals overlap and must not be added as serial timings.
- Genuine Home Manager deployment: `/tmp/pwv-NL5ggL/run.json`, passed activation/default-target startup, permissions/environment, durable write/restart, real HTTP PTY, service shutdown/group absence/closed port. Outer duration 94.123s including realization; guest test 19.86s. Package `/nix/store/2c99hfb84lkxra9m8swzr28sdv92wir2-brabbler-0.9.3` installs `bin/brabbler` and `lib/node_modules/brabbler` and runs `brabbler.service`.
- Command log/timing: `/tmp/brabbler-rename-all-2.log`, `/tmp/brabbler-rename-all-2-timing.json`.

Retained failures: `/tmp/brabbler-rename-all.log` (one negative harness fixture replaced the store basename instead of the installed-package suffix after the unscoped rename; the fixture now targets `/node_modules/brabbler` explicitly without weakening the validator), `/tmp/brabbler-test-core.zUiXhF/run.json`, `/tmp/brabbler-test-browser.DcSP3O/run.json`. A later focused invocation selected a nonexistent test name and stopped during runner setup (`/tmp/brabbler-test-core.y0IlQq/run.json`); the corrected three-file selection passed 57 tests (`/tmp/brabbler-test-core.jxY4Bx/run.json`) before the final complete run. These failures remain evidence, not passing acceptance. Standalone demo production compilation was not part of the application acceptance; its identity, instructions and source were reviewed.

This plan's final result/closure edits are documentation-only after the tested source. The tested package identity remains the exact verification boundary; earlier tests are not represented as fresh execution of later documentation edits.

## Rollback / Recovery

Do not activate the renamed package against existing live data before the separate migration. Old runtime data, source copies and user worktrees remain untouched. The rename is isolated in `feat/brabbler-rename`, based on local main `1c1d27a21f48345d40222a167e48664197bffe7d`. The future one-time migrator must handle application-owned files, repository markers, session metadata and browser state deliberately, without rewriting arbitrary conversation text, project paths or historical receipts. No migration is claimed implemented or executed by this plan.

## Completion Checklist

- [x] Current application interfaces consistently use Brabbler; retained old names have attribution, third-party, historical or security-exclusion reasons.
- [x] No normal-runtime compatibility fallback, migration tool, release, host deployment or live-data modification was introduced. Only isolated deployment acceptance ran.
- [x] Required application acceptance passed and independent-review findings were resolved; the standalone-demo compilation limit is explicit.
- [x] Git completion intent is local `main` by unsigned non-fast-forward merge, with exact execution separately gated. Migration, activation, hostname/URL and the foreign NixOS input update remain separate work; none is represented as executed here.
