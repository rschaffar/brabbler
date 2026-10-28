# Robot branding and README capture

## Goal

Apply the user's approved head-only, crooked-antenna Brabbler robot unchanged to the application and README, and replace the inherited upstream screenshot with a representative capture of the real packaged UI using synthetic content.

## Context

The user approved this work and the dedicated `feat/robot-branding` worktree, based on local main `7aeb430f803556125abc24213ecd46f87c262efb`. Existing active plans do not own branding. The approved draft is `/tmp/brabbler-robot-face.uW5SKT/robot-face.svg`; preserve its geometry, colors and round antenna tip. Static branding is the default; retain the animation as editable/reproducible design material, not an always-moving application control.

## Plan

- [x] Preserve the approved vector and animation generator in maintained sources; derive application/demo PNG icons and a multi-size favicon without changing package dependencies. Check deterministic regeneration and dimensions.
- [x] Apply the mascot to sidebar, empty-chat/login branding, offline/PWA assets and the static demo's corresponding copies, preserving accessible text and existing interactions. Verify relevant asset/manifest/service-worker contracts.
- [x] Capture a polished dark desktop workspace with synthetic chat, tools and a file panel inside the existing Nix browser fixture; inspect the actual pixels and record provenance. Do not use live sessions or the installed host service.
- [x] Update README branding, screenshot and current branding documentation; remove the now-obsolete current claim that the application retains the π icon. Preserve historical evidence.
- [ ] Review the settled candidate independently and complete Nix core/static/plugin, full browser/terminal inventory and genuine Home Manager VM acceptance. Record exact inputs, results, timings and artifacts.
- [ ] Hand the verified candidate to the global Git lifecycle for rebase/revalidation, exact local-main non-fast-forward integration approval, and separately gated cleanup. That lifecycle and its durable execution receipts own these remaining operations, not the implementation plan.

## Non-goals

No redesign, deployment, service restart, NixOS consumer mutation, publication, migration, credential access, live-data screenshots or legal-clearance claim. Existing historical screenshots and unrelated worktrees remain untouched.

## Completion Checklist

- [x] Approved artwork is durable and reproducible; app/demo assets agree.
- [x] Branding and README screenshot have been visually inspected and source-reviewed.
- [ ] All required acceptance levels pass for the relevant settled inputs.
- [ ] Maintained branding guide owns regeneration/provenance; archive the completed plan after evidence is recorded.
- [ ] Exact candidate handoff explicitly retains integration/cleanup with the global Git lifecycle; do not claim those operations from plan archival.

## Focused evidence and screenshot provenance

- Generator produced and byte-checked all eleven outputs; static SVG and talking GIF match the approved originals exactly. Main/demo artwork and icons share the generator.
- Nix core selection `--jobs 2 --file app/manifest.test.mjs --file public/sw.test.mjs` passed all 18 tests plus typegen/typecheck/lint in 41.486s. Seven pre-existing lint warnings remain, zero errors.
- Packaged appearance passed in 107.425s including initial package realization. A separate polished synthetic-Git/timestamp capture passed in 34.492s (capsule execution 22.869s); these are not comparable cold/warm benchmarks. Logs/timings: `/tmp/brabbler-branding-focused.0u86uxks/`.
- Imported, visually inspected screenshot: `/nix/store/ci8628a2ndqjmij3agip2146s2g3lrgr-brabbler-browser-appearance-diagnostics/artifacts/readme-dark.png`; PNG SHA256 `c315d9c790eaeac01026704cb59e37153265f29011370b0baecc140fba0e53e0`, 1440×960. Capture source digest `23f98c388f7ad6f56410a01e59443501b971e2bdb46604bbd64d7da17253492b`, application `/nix/store/ambkhp8pqpbqx2xz7hjxy0fdf57sg19v-brabbler-0.9.3`.
- Independent read-only reviewer `01a18229-da6f-727b-b559-494165ed2ef3` found no concrete blockers. It made no execution or demo-build claims; parent verified the completed second capture and import separately.

