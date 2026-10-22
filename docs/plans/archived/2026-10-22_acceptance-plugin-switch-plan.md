# Optional Acceptance bundled plugin

## Goal

Make managed Acceptance optional through the existing bundled-plugin settings: one global Enabled switch, disabled by default. The user explicitly chose both scope and default. Preserve server-owned queue/evidence and existing job control when the tools are disabled.

## Context and relationship

Feature checkout `feat/acceptance-plugin-switch` starts from local main `41f14164f93956f907ad4a381b8874c7cfe66f06`. This follows the archived project-acceptance-coordinator plan and ADR 0031; it changes exposure/admission, not snapshot identity, supervision, resource widths or Git policy. Existing acceptance performance investigations own their separate benchmarks. An unmanaged 32-core benchmark was observed at initial inspection; no checks will run alongside it without reassessing coordinated resources. No deployment/publication is authorized.

## Architecture

- Add a thin bundled Acceptance manifest/registry adapter, global-only `enabled=false`, using generic plugin settings and live tool hiding. Do not move the coordinator into session lifetime or introduce another plugin framework.
- Remove unconditional ordinary-session registration; retain explicit Acceptance-only integration for extension-enabled subagents and preserve their tool restrictions. Do not load unrelated bundled plugins into children.
- Independently enforce enabled state at model/browser submission, after asynchronous capture/approval, and immediately before dispatch. A queued disable transition must not be forgotten by rapid re-enable.
- Cancel known not-started queued jobs on disable, persist their cancellation before releasing ownership, and never automatically restart them on enable. Already-started supervisors continue normally; disabling is not process cancellation or settlement proof.
- Preserve browser queue/history/log/cancel/recovery access and profile configuration while disabled. Show disabled state and direct users to Settings → Plugins → Acceptance. Retain all existing profiles/artifacts.

## Plan

- [x] Add manifest, thin extension/registry wiring and default-off global policy; verify native SDK startup/live tool changes and restricted subagent loadouts. Reopened after the complete-run model-speed failure, then closed after the startup-lease repair and focused native/browser verification below.
- [x] Add independent admission/dispatch gates and latched queue cancellation; verify disabled, rapid-toggle, in-flight capture/verification, active-run drain and persistence paths with focused tests.
- [x] Update browser disabled status and existing packaged Activity fixture to exercise the genuine plugin switch, pending cancellation, active-run observation/cancel and retained profiles/history at desktop/tablet/mobile sizes.
- [x] Obtain independent scoped safety review, update acceptance/session/feature guides and ADR 0031, then run full fresh core/browser/terminal/deployment acceptance after source settles and resources are available.
- [x] Commit reviewable changes and evidence, prepare exact candidate for separately approved local main non-FF integration; do not deploy/publish.

## Focused evidence and review

All checks below used fresh ordinary Nix sandboxes on this x86_64-linux checkout; none is complete acceptance. The initial benchmark process had exited before checks began. No acceptance deadlines, coverage or resource contracts changed.

- `nix run --no-write-lock-file .#test -- core --file plugins/acceptance/runtime.test.mjs`: passed, 68s command runtime; `/tmp/pi-acceptance-switch-native.woI9NI/driver.log`. Initial coordinator focus also passed in 72s at `/tmp/pi-acceptance-switch-coordinator.BaCbuL/driver.log`; both exported content/mode SHA256 `72d5dc7a7f35a081f7812a188197c9a914469c663d7852087337c4fafc28f98a`.
- `nix run --no-write-lock-file .#test -- core --file lib/acceptance/interfaces.test.mjs`: 5 tests passed, 57s command runtime; `/tmp/pi-acceptance-switch-interfaces.LRr22D/driver.log`. This preceded the final throwing-subscriber addition to the approval regression.
- `nix run --no-write-lock-file .#test -- e2e --group activity`: passed all three desktop/tablet/mobile receipts, 328s command runtime; level interval 323.3s, approximately 96.5s before group execution and 226.8s group execution. Artifacts `/tmp/pi-web-test-browser.XtjWJK/run.json`; driver `/tmp/pi-acceptance-switch-browser.M0LG06/driver.log`; source SHA256 `e00094cf74aa23d3b2348da5193c9f0ab2e1e573747b5a99ec1a8c4d8db61114`. This immutable run preceded the final settings-subscriber isolation repair.
- Independent read-only safety review identified that a throwing SDK exposure-refresh listener could suppress later disable subscribers after a saved setting change. Repaired synchronous fanout with per-subscriber exception isolation and separate diagnostics; added queue and pending-approval regressions. The reviewer confirmed the repair and found no remaining concrete blockers. Hidden initial definitions had already repaired the startup child-allowlist issue without widening restricted grants.
- Post-repair `nix run --no-write-lock-file .#test -- core --file lib/acceptance/coordinator.test.mjs`: all 24 tests passed, 47s command runtime; `/tmp/pi-acceptance-switch-revocation.B1Ip8O/driver.log`, `/tmp/pi-web-test-core.E6tv0Z/run.json`. Includes natural active-job settlement while disabled and throwing-listener rapid-toggle revocation.

## Failed complete attempt (retained)

`nix run --no-write-lock-file .#test -- all --workers 4 --jobs 4` on implementation commit `7e0fd108116738ae64ccffa2e80e8872e8db6df2` failed after 409s command runtime: the first model-speed scenario received HTTP 500 for `set_model` at `e2e/model-speed.mjs:479`. Source SHA256 `6538cb80db07d7107678eb95174e1b1a84619da6c7e54fccf3a0b2aef69b6423`; driver `/tmp/pi-acceptance-switch-all.qO695O/driver.log`; source/selection `/tmp/pi-web-test-source-RP7xsB/`; browser `/tmp/pi-web-test-browser.lmj2aV/run.json`; failure capsule `/nix/store/s4ji1h6wcb30isyyda0j2r6bakxm0yxx-pi-web-browser-model-speed-diagnostics/artifacts/`. Core `/tmp/pi-web-test-core.GaUKTL/run.json` was interrupted by the complete driver's fail-fast handling, not passed; remaining browser groups and deployment are not complete evidence. No integration or deployment followed.

The original POST helper omitted the error response. Bounded failed-response diagnostics (no suppressed errors/deadline changes) exposed the same failure in a diagnostic-only focused run: `Cannot apply model definitions while a session sharing this runtime is busy. Try again when idle.` That run failed in 30s; `/tmp/pi-acceptance-switch-speed-diagnosis.rt122i/driver.log`, `/tmp/pi-web-test-browser.sL8oLq/run.json`. This reproduced the failure, not a repair.

A separate read-only researcher identified startup readiness being published before the extension-binding runtime-use lease's `.finally` released it. `ensureExtensionsBound()` now returns its in-flight settlement promise before consulting the readiness boolean; no shared-runtime guard is relaxed. Added a native ordinary-wrapper startup/immediate-first-`set_model` regression without `waitUntilReady`, retaining shared-sibling/busy/retirement coverage. Independent review confirmed this minimum repair.

Post-repair focused checks: `nix run --no-write-lock-file .#test -- core --file lib/rpc-manager-model-config.integration.test.mjs` passed in 49s (`/tmp/pi-acceptance-switch-startup.8ftPtL/driver.log`, `/tmp/pi-web-test-core.hzOTSl/run.json`). `nix run --no-write-lock-file .#test -- e2e --group model-speed` passed all four desktop/mobile exercise/fresh-context receipts in 120s command runtime, approximately 83.2s before group execution and 32.5s group execution (`/tmp/pi-acceptance-switch-speed-fixed.7w9q1J/driver.log`, `/tmp/pi-web-test-browser.k74Bnw/run.json`; source SHA256 `5b03b251b4a326ae1b033b046a4dfc97e1d19c4e6fbdc8d5ed6da2637a3b9a18`). These are not full acceptance.

Local main advanced to `1fd0bc52154f9962157ca8afbbcc7cee4ceba133` with the independent notebook/language-metadata change during verification. Rebase onto its current tip before the final complete run; earlier focused results do not cover those newly integrated inputs.

## Complete final acceptance

After unrelated runs settled, rebased onto current local main `32cb74b966a129ddc0add56a8d62fdef21443a1b` (including the notebook/language-metadata and selected-worktree merge-guard changes). Tested clean candidate **`64ba67a9094025d9fca8e6116d4402275f195113`** with `nix run --no-write-lock-file .#test -- all --workers 4 --jobs 4`: **passed**, exit 0, **562s end-to-end command runtime**, including in-run realization/source preparation, excluding the preceding model work and resource-coordination wait. No production service was contacted or changed.

- Source content/mode SHA256 **`59d0d1272e7fded205776445b486ab5a19fdd5d23fa48d16b0ca628c94f94540`**; source/selection `/tmp/pi-web-test-source-a6T7aJ/{source.json,selection.json}`. Requested/effective widths: four browser sandboxes and four core workers, overlapping. Admission estimated 16 CPUs / 28,991,029,248 bytes against 32 CPUs / 54,863,839,232 available bytes; estimates are not reservations. Other observed full/16-worker runs had settled before launch.
- Core/static/plugin: **409 files, 3,090 tests, 12 suites**, no failures/skips/unknown settlement; `/tmp/pi-web-test-core.kmeFtZ/run.json`. Core level wall interval **430.2s**, including exporter/typegen/typecheck/lint preparation and tests; separate phase wall timings are not emitted. Existing unrelated `ReviewFileBrowser` hook warnings remain warnings (zero lint errors).
- Browser/terminal: **26 groups / 59 scenario receipts**, all passed; `/tmp/pi-web-test-browser.bjPcFf/run.json`. Level wall interval **482.9s**: approximately **93.2s preparation before the first group**, then **389.6s parallel group-execution window**. Includes the genuine Settings toggle at desktop/tablet/mobile sizes, retained data/control while off, and fixed model-speed startup.
- Genuine Home Manager deployment VM: all activation, environment permissions, HTTP write, restart persistence and production PTY checks passed; `/tmp/pwv-zmIJ8R/{run.json,artifacts/acceptance.json}`. **72.3s** level wall interval including realization/startup; VM test-script interval **19.5s**. This is isolated deployment acceptance, not host deployment.
- Driver `/tmp/pi-acceptance-switch-final-all.FgbB5h/driver.log`. No coverage, worker budgets, deadlines or isolation were reduced. The earlier failed attempt remains retained above; the passing run contains the actual startup-lease repair and rebased inputs.

Implementation and maintained-guide handoff are complete. The evidence/status-only archive follow-up does not change tested runtime/Nix/test inputs; verify that delta separately rather than relabel this run as a later-tip execution. Local integration still requires its exact-state unsigned non-FF approval; deployment/publication and feature-resource cleanup remain separate operations.

## Risks and recovery

Hiding declarations alone cannot revoke stale invocations. A switch save racing asynchronous preparation/verification must block effects; rapid disable/enable must not resurrect already-queued jobs. Failure to durably cancel remains fail-closed without releasing unproven work. Existing running jobs remain independently owned with browser control even after tools disappear. Missing/malformed plugin settings mean disabled, never a new permission grant. No settings migration or artifact deletion is required; a rollback preserves private profiles/history and follows explicit user control rather than implicitly starting work.

## Completion Checklist

- [x] User-selected global-only/default-off behavior and native/browser/queue regressions pass.
- [x] Complete acceptance passes on recorded exact inputs with command, resource selection, timing and artifacts retained.
- [x] Review findings resolved and maintained documentation reflects the switch and drain semantics.
- [x] Feature history is ready for exact-state integration approval; remote/deployment boundaries preserved.
