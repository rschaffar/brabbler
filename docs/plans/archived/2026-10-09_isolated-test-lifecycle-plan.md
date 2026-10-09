# Per-invocation test isolation and bounded dependency storage

## Goal

Implement the user's approved design: independent simultaneous test invocations,
including reviewers in the same worktree, with cached Nix dependencies and no
unbounded accumulation of regenerable dependency copies. Retain useful evidence
and never clean resources while owned processes may still use them.

## Context

The previous inventory found about 84 GiB in retained offline execution roots.
The user authorized removing 63 named successful roots' dependency copies: 62
existed and approximately 60.3 GiB was removed; evidence remained. These are
historical measurements, not benchmarks of this implementation.

Retraction: the earlier assertion that all tests need writable, checkout-local
packages was too broad. Core typegen/typecheck/lint/Node tests do not invoke
Turbopack. Read-only store links are a compatibility gate, not yet a proven fact.
Ext4 makes the current `cp --reflink=auto` fall back to full copies.

## Plan Relationship

The completed development-verification plan owns existing harness diagnostics.
This plan changes execution workspace and retention policy, not application
features, Git authority, acceptance coverage, or assertion deadlines. Maintained
contracts remain in `docs/testing.md` and `e2e/README.md`.

## Architecture

- Nix retains manifest/toolchain-keyed immutable dependencies. A test shell does
  not prepare checkout-local `node_modules`; the manual development shell does.
- Core runs preserve filtered source snapshots and use read-only store modules.
- Browser/terminal invocations snapshot source and use their own local dependency
  copies, `.next`, fixtures, ports and reports; no shared checkout dev server.
- A run owner records exact source/dependency identities, command results and
  settlement. Only that owner's regenerable bulk can be cleaned after settlement,
  on pass or failure. Interrupted/uncertain execution is retained conservatively.
  An explicit keep-workspace option disables automatic bulk cleanup.
- Reports/manifests and failed fixture state are retained. Existing unrelated
  roots are never swept. Cached Nix checks remain distinct from fresh execution.

## Non-Goals

Filesystem migration, hardlinks, mount/overlay infrastructure, global job
schedulers, dependency upgrades, production builds, remote operations, and
cleanup of existing resources. No broader network-sandbox claim.

## Plan

- [x] Add a non-materializing test shell and validate a full core run with linked immutable modules; record exact evidence and fall back only on a demonstrated incompatibility.
- [x] Add owned run lifecycle/settlement and bounded bulk cleanup with regressions for pass, failure, interruption, replacement paths, symlinks and retention override.
- [x] Give browser/terminal invocations separate source/dependency/generated workspaces while preserving existing diagnostics, fixture isolation and explicit non-Linux limitations.
- [x] Verify two core invocations and two browser invocations from the same worktree use disjoint writable state and matching cached dependencies without downloads.
- [x] Complete the common baseline plus general/plugin browser and terminal acceptance, independent safety review, and documentation updates; retain exact commands/results/artifacts.
- [x] Commit reviewed work and resolve completion intent; integration and feature cleanup remain separate gated operations. Implementation commit: `60c668dd36f422ecf9eb37b6ad317006c23cf93c`; user selected local `rst-main` integration after verification.

## Risks and Recovery

Process observation is bounded, not proof about arbitrary escaped descendants.
Never interpret a failed assertion as unsettled processes, nor a zero exit status
as complete settlement. No deletion through store links, replacement roots or
mountpoints. Keep source/manifests/logs when a run refuses cleanup. Concurrent
runs need conservative worker budgets; there is no machine-wide reservation.
The store-link gate must include native SDK/PTY tests and static preparation.
The existing copies remain a fallback if compatibility fails; do not introduce
bind mounts silently. Source exporters must continue excluding private files.

## Completion Checklist

- [x] Same-worktree concurrent invocations cannot share `.next`, fixtures or report directories.
- [x] Warm dependency inputs are reused without network fetching or per-core-run module copies.
- [x] Settled failures release regenerable bulk; uncertainty and keep-workspace preserve it.
- [x] Evidence survives cleanup; retained paths/disposition and limitations are explicit.
- [x] Full acceptance and lifecycle regressions pass, or remaining blockers are honestly retained.

## Verification evidence

Base: `05f3f264d88bb6ab561780046ec491d0e4c9ed83`, isolated feature worktree
`isolated-test-lifecycle`. Application evidence below is against the working
candidate identified by the source manifests, before this evidence-only update.
All commands entered `nix develop --offline --no-write-lock-file .#test -c`.
No production build, package-manifest change or dependency upgrade occurred.

| Command/selection after shell entry | Result | Evidence |
| --- | --- | --- |
| Initial `node nix/test-offline.mjs` store-link gate | 267 files / 1,718 tests + static preparation passed | `/tmp/pi-test-lifecycle-store-link.I9fCWx.log` |
| `node nix/test-offline.mjs --jobs 2` concurrently with `--jobs 2 --file lib/test-lifecycle.test.mjs --file lib/e2e-harness.test.mjs` | Full 268 files / 1,734 tests and peer 27 tests passed; command wall after shell entry 150 s / 39 s | `/tmp/pi-test-lifecycle-stable-core.4oqpHC/{full,peer}.log`; roots `/tmp/pi-web-test-offline.WUoaOLuw` and `/tmp/pi-web-test-offline.i965unZs` |
| `npm run test:e2e` | Complete general desktop/mobile acceptance passed | `/tmp/pi-test-lifecycle-final-browser.meN4Oz.log`; `test-results/e2e/browser-7ZIpQY` |
| `env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` | Both viewports passed | `/tmp/pi-test-lifecycle-final-acceptance.IRWXAA/plugin.log`; `test-results/e2e/browser-S91xNT` |
| `npm run test:terminal` | Both viewports, real shell/session/reconnect/exit checks passed | `/tmp/pi-test-lifecycle-final-acceptance.IRWXAA/terminal.log`; `test-results/e2e/terminal-2FUtdu` |
| Two concurrent `env E2E_TIMESTAMPS_ONLY=1 npm run test:e2e` invocations | Both desktop/mobile selections passed; combined command wall after shell entry 20 s | `/tmp/pi-test-lifecycle-stable-browser.VZqkXq/{a,b}.log`; `browser-YWztGu` and `browser-UNPoFN` |

General/plugin/terminal source digest:
`819b944fd4872b8acc8ee1156517f0b04a6513939d0d2c2ab8d56a1bdb569772`.
Final concurrency source digest:
`a0d6770347bef838832e1fdf06502f41d591853e8f81d9cd48d4fc2583fa73d5`.
The intervening executable delta fixes only interruption arriving after owner
closure; its new process regression, full core and paired browser runs passed.
General/plugin/terminal normal-flow evidence is retained as earlier-input evidence,
not relabeled a new-tip run. Their outer wall times including shell entry were
355 / 306 / 43 seconds, not isolated suite-performance benchmarks.

Both final core lifecycles record the identical cached output
`/nix/store/qrlp92mvaz4x7xdmz9ladlwjrd1gwai0-pi-web-dev-modules-0.9.3/node_modules`.
All five acceptance manifests report resources settled, original server groups
absent and bulk removed. Actual dependency links/copies and `.next` were verified
absent afterward. Retained execution roots measured 15–37 MiB with `du -sh`
(source/fixtures; browser traces remain separately under test-results). The
original worktree still has neither `node_modules` nor `.next`.

Independent read-only review found and drove regressions for recycled session
PIDs, pending browser acquisitions, rejected phase supervision, inner receipt
vetoes, bound dependency inputs, partial cleanup, disappeared siblings during
signaling, and responsive-owner/late-interruption detached-child escalation.
The initial focused failure was an outdated structural test reading the former
suite filenames; the test now checks the moved suites. Its original output and
subsequent focused logs remain retained. Application assertions/deadlines were
not weakened and there were no automatic retries.

## Rebased candidate verification

During completion, local `rst-main` advanced to
`cbf620b302b63bee42f74c3abdcef00e0193271f` (nested cleanup artifacts).
Rebase completed without conflicts; `git range-diff` showed both feature patches
unchanged. The test-workspace ADR moved to 0020 to avoid the incoming 0019 number.
Plugin verification guidance now uses the non-materializing shell for core and
browser commands. These documentation edits were included in source digest
`13f4a52c17b6627ca70845f9fc091b73cc5189a85d8e92bec508eef7a7ed9c11`.

- `nix develop --offline --no-write-lock-file .#test -c node nix/test-offline.mjs --keep-workspace`:
  268 files / 1,734 tests and complete static preparation passed; command 124 s
  after shell entry. Log `/tmp/pi-test-lifecycle-rebased-core.Fbx9Em.log`;
  root `/tmp/pi-web-test-offline.ynZrTkoD`, deliberately kept for the following
  plugin check (immutable dependency link, not a retained dependency copy).
- `node --experimental-strip-types --test 'plugins/**/*.test.mjs'` in that retained
  source, with `fixtureEnvironment` and `runOwned`, isolated Git configuration and
  disabled Jiti cache: all 185 tests passed and observed resources settled in
  80.849 s. Exact executable/arguments, settlement and TAP are in that root's
  `plugin-integration.json` and `plugin-integration.log`.
- `nix develop --offline --no-write-lock-file .#test -c env E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e`:
  both viewports including nested cleanup passed, command 334 s after shell entry.
  Log `/tmp/pi-test-lifecycle-rebased-plugin-browser.dQhnza.log`;
  report `test-results/e2e/browser-z0mzKh`; snapshot `/tmp/pwe-JFWsgF`.
  Inner resources settled, server group absent, dependency copy and `.next` removed.

General browser, terminal and paired-invocation evidence remains scoped to the
previously recorded input. The incoming delta changes optional-plugin behavior,
not those suites or their shared harness; combined core/plugin checks above cover
the affected integration. This final evidence edit changes no executable inputs.

## Remaining boundaries

Linux x86_64 was exercised; other systems were not. Non-Linux acceptance remains
explicit legacy `--in-place`. Same-worktree concurrency was exercised; a separate
cross-worktree/live-manual-dev-server trial was not performed. Process observation
is bounded, not OS containment.
Source snapshots, traces and failed fixtures still consume space intentionally;
only run-owned regenerable bulk is automatically removed. Npm-only installed-lock
validation has regression coverage, not a separate full npm-only installation run.
The cacheable Nix check remains distinct from fresh app acceptance. Durable
choices are in ADR 0020; operational behavior is in the testing/browser guides.
Implementation is committed and local integration intent is resolved. This
archive-only follow-up does not change tested executable inputs; it receives
Markdown-link and diff validation, not a redundant application-suite run.
Exact integration approval and resource cleanup remain under the Git skill.
