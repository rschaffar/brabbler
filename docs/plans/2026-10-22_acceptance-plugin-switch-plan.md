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

- [x] Add manifest, thin extension/registry wiring and default-off global policy; verify native SDK startup/live tool changes and restricted subagent loadouts.
- [x] Add independent admission/dispatch gates and latched queue cancellation; verify disabled, rapid-toggle, in-flight capture/verification, active-run drain and persistence paths with focused tests.
- [x] Update browser disabled status and existing packaged Activity fixture to exercise the genuine plugin switch, pending cancellation, active-run observation/cancel and retained profiles/history at desktop/tablet/mobile sizes.
- [ ] Obtain independent scoped safety review, update acceptance/session/feature guides and ADR 0031, then run full fresh core/browser/terminal/deployment acceptance after source settles and resources are available.
- [ ] Commit reviewable changes and evidence, prepare exact candidate for separately approved local main non-FF integration; do not deploy/publish.

## Focused evidence and review

All checks below used fresh ordinary Nix sandboxes on this x86_64-linux checkout; none is complete acceptance. The initial benchmark process had exited before checks began. No acceptance deadlines, coverage or resource contracts changed.

- `nix run --no-write-lock-file .#test -- core --file plugins/acceptance/runtime.test.mjs`: passed, 68s command runtime; `/tmp/pi-acceptance-switch-native.woI9NI/driver.log`. Initial coordinator focus also passed in 72s at `/tmp/pi-acceptance-switch-coordinator.BaCbuL/driver.log`; both exported content/mode SHA256 `72d5dc7a7f35a081f7812a188197c9a914469c663d7852087337c4fafc28f98a`.
- `nix run --no-write-lock-file .#test -- core --file lib/acceptance/interfaces.test.mjs`: 5 tests passed, 57s command runtime; `/tmp/pi-acceptance-switch-interfaces.LRr22D/driver.log`. This preceded the final throwing-subscriber addition to the approval regression.
- `nix run --no-write-lock-file .#test -- e2e --group activity`: passed all three desktop/tablet/mobile receipts, 328s command runtime; level interval 323.3s, approximately 96.5s before group execution and 226.8s group execution. Artifacts `/tmp/pi-web-test-browser.XtjWJK/run.json`; driver `/tmp/pi-acceptance-switch-browser.M0LG06/driver.log`; source SHA256 `e00094cf74aa23d3b2348da5193c9f0ab2e1e573747b5a99ec1a8c4d8db61114`. This immutable run preceded the final settings-subscriber isolation repair.
- Independent read-only safety review identified that a throwing SDK exposure-refresh listener could suppress later disable subscribers after a saved setting change. Repaired synchronous fanout with per-subscriber exception isolation and separate diagnostics; added queue and pending-approval regressions. The reviewer confirmed the repair and found no remaining concrete blockers. Hidden initial definitions had already repaired the startup child-allowlist issue without widening restricted grants.
- Post-repair `nix run --no-write-lock-file .#test -- core --file lib/acceptance/coordinator.test.mjs`: all 24 tests passed, 47s command runtime; `/tmp/pi-acceptance-switch-revocation.B1Ip8O/driver.log`, `/tmp/pi-web-test-core.E6tv0Z/run.json`. Includes natural active-job settlement while disabled and throwing-listener rapid-toggle revocation.

## Risks and recovery

Hiding declarations alone cannot revoke stale invocations. A switch save racing asynchronous preparation/verification must block effects; rapid disable/enable must not resurrect already-queued jobs. Failure to durably cancel remains fail-closed without releasing unproven work. Existing running jobs remain independently owned with browser control even after tools disappear. Missing/malformed plugin settings mean disabled, never a new permission grant. No settings migration or artifact deletion is required; a rollback preserves private profiles/history and follows explicit user control rather than implicitly starting work.

## Completion Checklist

- [ ] User-selected global-only/default-off behavior and native/browser/queue regressions pass.
- [ ] Complete acceptance passes on recorded exact inputs with command, resource selection, timing and artifacts retained.
- [x] Review findings resolved and maintained documentation reflects the switch and drain semantics.
- [ ] Feature history is ready for exact-state integration approval; remote/deployment boundaries preserved.
