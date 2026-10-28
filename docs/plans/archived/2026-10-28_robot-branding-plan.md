# Robot branding and README capture

## Goal

Apply the approved head-only, crooked-antenna Brabbler robot to the application and README, and replace the inherited upstream screenshot with a representative packaged-UI capture using synthetic content.

## Context and boundaries

The user authorized implementation and the dedicated `feat/robot-branding` worktree, initially based on local main `7aeb430f803556125abc24213ecd46f87c262efb`. A patch-identical rebase onto `474b75ab912717d88948b72aee6ffd1d9142ac05` produced implementation `9f961ae27cdb93dad87b99917f1c6897645cb920`; correction/capture commit `157e72bbca7ce9b11baeb4372e2df63cc0e585b6` is the final verified implementation candidate.

No redesign, live deployment, restart, NixOS consumer change, publication, migration or credential access was included. The approved round antenna tip remains unchanged. Historical screenshots and unrelated worktrees are retained. Demo synchronization is source-reviewed, not a demo production-build claim.

## Plan

- [x] Preserve the exact approved vector and animation poses; generate eleven matching main/demo SVG/PNG/favicon/GIF outputs without dependency changes. Static SVG and animation byte-match their approved originals.
- [x] Use static branding in sidebar, empty chat/login, PWA/offline assets and demo counterparts, preserving accessible button text and native Pi ownership. The Sidebar's static SVG uses a native decorative image, not an unnecessary raster optimizer.
- [x] Capture a real dark desktop workspace with authored conversations/tool history and a private example Git project. Require actual colored syntax tokens in both file and chat; retain the exact image explicitly approved by the user.
- [x] Update README and the maintained branding guide; remove obsolete current π-icon claims without rewriting historical evidence.
- [x] Independently review the final changes and pass complete Nix core/static/plugin, browser/terminal and genuine Home Manager VM acceptance.
- [x] Hand off the verified candidate to the global Git lifecycle. Its exact approval gates and durable receipts own local-main unsigned non-fast-forward integration and separate cleanup; archival is not proof of their execution.

## Screenshot review and correction

**Retraction:** the first screenshot was called representative, but the user rejected it as unattractive and lacking syntax highlighting. That visual acceptance was withdrawn. The superseded uncommitted plan is retained at `/tmp/brabbler-robot-all-final.95qb2_rt/plan-before-screenshot-review.md`; the rejected PNG remains in its immutable run artifact.

FileViewer deliberately renders plaintext before lazy Prism grammar publication. The old capture waited for source text/fonts/images, not styled tokens. No production highlighting code needed changing: the capture now awaits actual `.token` text and a computed keyword color distinct from the enclosing code color, on both surfaces, without sleeps or injected styles. A short TypeScript conversation example and tighter 1440×900 composition complete the revision.

The user explicitly approved the resulting image: `docs/screenshots/brabbler-workspace.png`, SHA256 `1955f40535f97433da3c3e0b77acd916fc42e75120be2ad8c9a2cbae53e21c36`. Original capture: `/nix/store/lz25ff78v3bh4dkyqyza7w71d0bc91hr-brabbler-browser-appearance-diagnostics/artifacts/readme-dark.png`; adjacent `readme-highlighting.json` records genuine keyword blue `rgb(86, 156, 214)` versus base `rgb(212, 212, 212)`. That exact approved PNG is retained, not replaced by a later timestamp variant. Focused appearance passed in 35.881s (22.352s capsule); evidence `/tmp/brabbler-readme-highlight._i5ced5u/`.

## Final complete acceptance

`nix run --no-write-lock-file .#test -- all --workers 4 --jobs 12` passed in **454.805s end-to-end**. Requested/effective widths were **12 core / 4 browser**, with overlap: 45.623 GiB available and 32 CPUs admitted the documented 12/4 profile. Before the command, a separately measured 43.611s focused core/static run passed 31 tests and a 36.365s appearance run realized the same frozen browser support. This is warm-prerequisite evidence, not a cold-cache benchmark or a comparison with earlier runs.

- **526 files / 4,319 tests / 14 suites**, zero failures/skips/cancellations. Core envelope 414.589s; file-execution envelope 411.493s. Report `/tmp/brabbler-test-core.cARAxT/run.json`; immutable output `/nix/store/y188zg1swwvphg165bsh6xibwi3wp8v3-brabbler-core-checks/`.
- **26 browser/terminal groups / 60 scenarios**, all passed. Browser envelope 422.234s, support realization 2.890s, definition publication 7.215s. Report `/tmp/brabbler-test-browser.SQ6MFq/run.json`.
- **Genuine Home Manager VM passed**: envelope 26.958s, guest execution 19.727s. Report `/tmp/pwv-YlItfO/run.json`.
- Intervals overlap and are not additive. Seven pre-existing lint warnings remain, zero errors. Logs/timings/admission: `/tmp/brabbler-branding-settled.47_3hzhk/`, particularly `all.log`, `all-candidate.json`, `all-timing.json` and `evidence-summary.json`.
- Frozen input digest `c028278c053aac363011c9b17c334a8a2a6eab4e6768fb31ae884a4614f8e60b`; store source `/nix/store/9fcyr1ndyk302xfm9nsfhc4lsimszrbq-source`; application `/nix/store/0my0id1xsw3fj736npy6xk6kid7fxsd2-brabbler-0.9.3`. Worktree evaluation returned that same application after verification.
- Reviewer `01a18229-da6f-727b-b559-494165ed2ef3` found no concrete blockers in branding, native SVG correction or final capture delta. Read-only findings are not execution evidence. The capture keeps errors live through context closure and does not alter functional scenario accounting.

## Retained earlier evidence and limitations

The first full attempt stopped in 197.462s because seven real mounted Sidebar cases rejected the newly introduced `next/image` export as an object. Replacing only that new static-SVG import/render with native `<img>` passed 13 Sidebar tests plus static checks in 44.533s, without assertion/fixture weakening. Logs: `/tmp/brabbler-robot-all.zi1yfaxr/`.

A later attempt stopped before tests in 7.440s at the strict immutable-source identity guard. The affected store copy matched the worktree's bytes, had mode 0444 and 1,155 hard links, with ctime inside the attempt. A shared-store metadata race is suspected, not proven or fixed. No guard changed. After separate prerequisite realization, unchanged input `eeb8aed3598f31e9e6b5936d5259f1372373712b2502e8fce5bd7b8f05a46dbc` completed full acceptance in 404.140s at resource-admitted 4/4; this predates the user's screenshot correction and is not relabelled as final-capture evidence. All failure/preparation/earlier acceptance records remain under `/tmp/brabbler-robot-all-final.95qb2_rt/`.

## Completion Checklist and handoff

- [x] Exact approved artwork is durable/reproducible; main/demo assets agree.
- [x] The improved actual screenshot has native syntax colors and explicit user approval.
- [x] Complete acceptance passes for the final implementation/capture input above.
- [x] [Branding](../../branding.md) owns regeneration and screenshot mechanics; historical evidence is retained here.
- [x] Only evidence/status documentation changes after the final run. Exact-tip checks must confirm unchanged application/test inputs and application derivation before integration.
- [x] Integration/cleanup are explicitly retained with the global Git lifecycle and its receipts, not claimed from this archive. No remote or live deployment is authorized.
