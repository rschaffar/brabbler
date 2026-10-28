# Robot branding and README capture

## Goal

Apply the user's approved head-only, crooked-antenna Brabbler robot unchanged to the application and README, and replace the inherited upstream screenshot with a representative capture of the real packaged UI using synthetic content.

## Reopened by user screenshot review

The user rejected the 1440×960 image as unattractive and missing syntax highlighting. The earlier acceptance below remains evidence for its exact frozen input, not acceptance of the screenshot's visual quality. Retraction: text/fonts/image readiness was insufficient; the capture did not await actual styled TypeScript tokens. The revised capture must wait for native token colors in file and chat, improve the composition and be visually reviewed before integration. The superseded uncommitted plan is retained at `/tmp/brabbler-robot-all-final.95qb2_rt/plan-before-screenshot-review.md`; no merge has occurred.

The revised appearance capture passed in 35.881s (22.352s capsule) and was visually inspected with genuine syntax colors in both panes. Current candidate image: `/nix/store/lz25ff78v3bh4dkyqyza7w71d0bc91hr-brabbler-browser-appearance-diagnostics/artifacts/readme-dark.png`, 1440×900, SHA256 `1955f40535f97433da3c3e0b77acd916fc42e75120be2ad8c9a2cbae53e21c36`. Adjacent `readme-highlighting.json` records native computed keyword blue `rgb(86, 156, 214)` versus base `rgb(212, 212, 212)` in both file and chat. No production highlighting code was changed. Evidence: `/tmp/brabbler-readme-highlight._i5ced5u/`; source digest `e43a71a31187ec85cc30675d40bdda393f384cd150d5d7ef2893ef28653c673e`. The user explicitly approved this exact revised screenshot. Revised-input static/full verification and final source review remain pending.

## Context and scope

The user authorized implementation and `feat/robot-branding` in its dedicated linked worktree, initially based on local main `7aeb430f803556125abc24213ecd46f87c262efb`. A patch-identical rebase onto `474b75ab912717d88948b72aee6ffd1d9142ac05` produced implementation commit `9f961ae27cdb93dad87b99917f1c6897645cb920`. Acceptance below covers that code plus the native static-SVG Sidebar correction. Existing active plans do not own branding.

No redesign, deployment, service restart, NixOS consumer mutation, publication, migration, credential access or live-data screenshot was included. The round antenna tip remains approved as-is. Historical screenshots and unrelated worktrees remain untouched. The static demo is synchronized/source-reviewed, not production-build verified.

## Plan

- [x] Preserve the approved vector and animation poses in maintained sources; generate matching main/demo PNG icons and native 16/32/48px favicons without dependency changes. All eleven generated outputs byte-check; static SVG and GIF match the approved originals.
- [x] Apply static branding to sidebar, empty chat/login, PWA/offline assets and demo counterparts. Preserve accessible button text and existing behavior; use a native decorative image for the Sidebar's static SVG rather than an unnecessary raster optimizer.
- [x] Capture and inspect a real packaged dark desktop workspace with authored synthetic conversations, tool history and a private example Git project; import the actual successful-run PNG.
- [x] Update README and current branding documentation, removing the obsolete current claim that the application retains the π icon. Preserve native Pi interfaces and historical evidence.
- [ ] Independently source-review the settled changes and pass Nix core/static/plugin, all browser/terminal groups and the genuine Home Manager VM acceptance.
- [ ] Hand off the verified candidate to the global Git lifecycle. Its exact approval gates and durable receipts own the remaining local-main unsigned non-fast-forward integration and separately approved cleanup; archival is not their execution receipt.

## Verification and retained failures

- `tools/branding/generate.mjs --check` verifies eleven named outputs. `app/manifest.test.mjs` checks PNG dimensions, self-contained SVG markup and complete favicon entry dimensions/bounds; the service-worker test retains its exact precache inventory.
- Focused Nix manifest/SW selection: 18 tests plus static checks, 41.486s. Initial packaged appearance: 107.425s including package realization; polished synthetic-Git capture: 34.492s, capsule execution 22.869s. Evidence: `/tmp/brabbler-branding-focused.0u86uxks/`. These are distinct cold/warm preparations, not a performance comparison.
- First full run stopped honestly in 197.462s: seven mounted Sidebar cases rejected the newly introduced `next/image` default export as an object. No assertion/fixture weakening: replacing only the new Sidebar image import with native `<img>` (mirrored to demo) passed all 13 Sidebar tests plus static checks in 44.533s. Logs: `/tmp/brabbler-robot-all.zi1yfaxr/`.
- A subsequent full attempt stopped before tests in 7.440s at the strict source identity guard for `hooks/useActivityController.ts`. The immutable store copy had the same SHA256 as the worktree, mode 0444, 1,155 hard links, and ctime within that attempt. A shared-store metadata race is suspected, not proven or fixed. The guard was unchanged. Corrected packaged appearance then passed on the same frozen source in 111.194s (21.713s capsule), realizing prerequisites before the final command. Failure, diagnostics and preparation evidence remain in `/tmp/brabbler-robot-all-final.95qb2_rt/`.
- Independent read-only reviewer `01a18229-da6f-727b-b559-494165ed2ef3` found no concrete blockers, including the narrow native-image correction. It made no execution or demo-build claims.

## Complete acceptance

`nix run --no-write-lock-file .#test -- all --workers 4 --jobs 4` passed in **404.140s end-to-end** after the separately reported prerequisite realization. Requested/effective widths were 4/4 with overlap: 42.026 GiB available and 32 CPUs, below the documented 43 GiB threshold for 12/4 overlap. No source/guard/assertion changes separated the preparation refusal from the successful same-input full run; a passing retry is not an infrastructure-fix claim.

- **526 files / 4,319 tests / 14 suites**, no failures/skips/cancellations; core 400.681s including preparation, file-execution envelope 397.645s. Report `/tmp/brabbler-test-core.ONpvZe/run.json`; immutable evidence `/nix/store/08bvc2nsiz7smvhjngdbj1pphriyyrm1-brabbler-core-checks/`.
- **26 browser/terminal groups / 60 scenarios**, all passed; browser envelope 291.179s, support 2.983s, definition publication 5.205s. Report `/tmp/brabbler-test-browser.JjiXFM/run.json`.
- **Genuine Home Manager VM passed**, envelope 63.827s, guest execution 19.865s. Report `/tmp/pwv-DJcZp0/run.json`.
- Intervals overlap and are not additive. Seven pre-existing lint warnings remain, zero errors. Logs/timing/admission summary: `/tmp/brabbler-robot-all-final.95qb2_rt/settled-all.log`, adjacent JSON records, and `/tmp/brabbler-test-source-tAOsGD/selection.json`.
- Frozen input digest `eeb8aed3598f31e9e6b5936d5259f1372373712b2502e8fce5bd7b8f05a46dbc`; projected test source `/nix/store/jcr3444p57q85ba2g2jwrxlh4z59zc4n-source`; verified application `/nix/store/0my0id1xsw3fj736npy6xk6kid7fxsd2-brabbler-0.9.3`.

## Current screenshot and handoff

The final imported PNG is `/nix/store/jghrb2k6nl3ygmx00g4245mpwkh45mg2-brabbler-browser-appearance-diagnostics/artifacts/readme-dark.png`, 1440×960, SHA256 `749d99131deaf17f389e4dff55485aa58ffb25c54dce9381ebf4c73af200fc2b`. It was visually inspected and copied without altering pixels. The earlier draft capture remains in its recorded Nix artifact; it is not relabelled as the final image.

Only the screenshot and evidence/status documentation change after that frozen full run; application and test code remain unchanged. Final Git verification must confirm the same application derivation and exact source-code/assets before integration. [Branding](../../branding.md) owns current artwork regeneration and screenshot capture; global Git receipts own integration/cleanup. No remote or live deployment is authorized by this plan.

## Completion Checklist

- [x] Approved artwork is durable/reproducible and main/demo assets agree.
- [ ] Revised README capture has real syntax colors, a representative composition, visual inspection and source review.
- [ ] Reassess and verify the revised capture input; retain unchanged earlier application evidence without relabelling its scope.
- [ ] Update the branding guide and current-image provenance after the revised capture is verified.
- [x] Integration/cleanup are explicitly retained with the global Git lifecycle, not claimed from archival.
