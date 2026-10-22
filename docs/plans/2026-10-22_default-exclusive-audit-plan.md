# Audit default-exclusive core tests in batches

## Goal

Audit the default-exclusive core files and move only demonstrably isolated files into the existing F/N pool. Preserve all existing test bodies, assertions, deadlines, exclusive barriers, resource admission and full browser/deployment acceptance. Measure a same-source, same-width control/candidate pair rather than promise scaling gains.

## Context

The user authorized auditing the 189 default-exclusive files observed in the previous core run. Reuse the existing isolated worktree `test/acceptance-eight-workers`, with one parent repository writer and independent read-only auditors. Main advanced with scratchpad changes; the clean worktree was rebased onto local main `41f14164f93956f907ad4a381b8874c7cfe66f06`, producing `27a5375b71f01f8d3821fb42e8fad3bd3fe6c765`. Current discovery has 192 defaults: the original 189 plus three incoming scratchpad test files. Audit inventory and per-domain assignments are retained at `/tmp/pi-web-lane-audit-iJSPOE` with exact file hashes.

The historical same-session baseline at `6aa1e7a` passed 405 files/3,046 tests with 21 effective workers; its 208-file serial tail was 181.204s, including 189 defaults. Rebase changes invalidate treating that observation as a matched current-source control. A new four/four control is required.

## Plan Relationship

This plan owns scheduling review, manifest promotions and validation only. The adjacent eight-worker plan owns optional wider budgets; its pending 8/8 experiment is not required here and is not silently marked complete. Preserve ADR 0025 and prior reviewed-core scheduling mechanisms. Explicitly held large-operations and model-speed-lifecycle files remain E unless their previously documented teardown/resource blockers are independently resolved; resolving those blockers is not part of this manifest-only task.

## Plan

- [x] Rebase onto current clean local main and freeze the 192-file inventory with hash-bound domain assignments.
- [x] Audit each assigned file and relevant helpers for process-local globals, source/fixture writes, literal paths/ports, credentials/network behavior, subprocess ownership, asynchronous teardown and timer sensitivity; retain per-file F/N/E verdict and evidence.
- [x] Freeze unchanged control and execute complete fresh four/four acceptance; record actual widths, source/package identity, intervals, counts and settlement.
- [x] Add bounded manifest-selection regressions, then promote reviewed-safe batches with file-specific isolation reasons and coarse measured ordering estimates; prove all original test bodies and previously reviewed entries are unchanged.
- [x] Run focused scheduling/native overlap validation, including writable-source mutation observation where native fixtures warrant it; retain failures without retries, deadline changes or suppression.
- [ ] Obtain independent safety review, freeze final candidate and execute all three complete acceptance checks at the same four/four budget; compare original per-file case/outcome sets and measured timings.
- [ ] Update owning testing guide with measured results and remaining held files; commit reviewable history and perform guarded main integration only after exact verification and separate approval. Cleanup/publication remain separate.

## Evidence checkpoint

- Control: `/tmp/pi-web-lane-control.laZZYR`, source digest `3027f6ff3a35f53ca61e72f394254720345d066c96f848aa5a0b035244196d27`. Fresh ordinary `all --workers 4 --jobs 4` passed in **433s**: core **427.828s** (62.854s before file execution; 364.635s file window; 225.324s E tail), browser **382.850s**, deployment **24.346s**. Four effective core workers/four actual browser sandboxes, all 408 files/3,063 tests, 26 groups/59 receipts and deployment/settlement passed. No deliberate prerequisite prewarming; command time includes realization. Package `/nix/store/11g5czgm41sr9812ab97blla4i83s2an-pi-web-0.9.3`.
- Audit: six domain batches produced 192 hash-bound verdicts. Initial proposal **129** promotions was reduced to **128 (86 F/42 N)** after independent review identified unjoined native media-stream closure in `reference-authorization`. **64** unresolved defaults stay E, with reasons recorded in `nix/test-lanes-audit-2026-10-22.json`; old explicit E entries are untouched. Initial suspicion that an SDK service factory was not exported was retracted after tracing the actual re-export chain; the model-config integration test remains held for an unreleased auth-gate failure path, not a missing export.
- Red: `/tmp/pi-web-lane-red.VFXfNG`, 43s, static/exporter checks passed, corpus metadata passed and the two initially requested manifest admission/explicit-hold contracts failed against the old manifest. The admission regression is unchanged. The hold contract was subsequently narrowed to preserving existing default-E semantics, not changing the old held-file assertions.
- Green: `/tmp/pi-web-lane-green.63LP5E`, 46s, all **35** metadata/runner cases and static/exporter checks passed. Existing test bodies and old manifest entries are byte/value unchanged.
- Diagnostic: `/tmp/pi-web-lane-observed.dRgRKN`, **189.358s**, verified source digest `fc1d65e41c47089fe2f960c5733a10bfe2e76b2c0e973c9a60e2d366dcec6359`. Exactly two diagnostic-only source deltas: a snapshot-local observer and the `nix/tests.nix` exec wrapper. All **134 files/1,089 tests** passed with four workers; all 42 newly native files overlapped peers and the old E barrier waited for pool drain. Exact original cases/counts/outcomes for 133 files match control; `/tmp/pi-web-lane-observed.dRgRKN/control-comparison.json` records this. Observer self-tests, 140 directory watches, zero mutation events, no lost/overflowed coverage and identical final source content/modes passed. Core `/tmp/pi-web-test-core.67SFWL`, output `/nix/store/c3lfy7gw6284ix7yma3p469sf77mk94n-pi-web-core-checks`. Independent observer review cleared its corrected fail-closed coverage/traversal/self-test behavior. Its bounded scope excludes restored mmap/external-hardlink mutations, arbitrary host effects and escaped descendants; Nix remains outer containment. This diagnostic is not ordinary acceptance or a benchmark.

## Risks

A per-file Node process isolates globals but not the shared writable source tree or host effects. Missing review is not proof of danger or safety. New N entries require real fixture isolation and settled subprocess/timer work, not simply a passing synthetic classifier. Wider scheduling can expose latent races; do not weaken test cases or broaden task scope automatically to hide them. Timing comparisons must separate realization/static preparation, execution, and overlapping browser/service intervals. Keep the repository's explicit held files exclusive.

## Completion Checklist

- [x] Every inventoried default has a documented hash-bound verdict or an explicit unresolved hold.
- [x] Only reviewed-safe files enter F/N; substantive original tests, deadlines and inventory are preserved.
- [ ] Focused isolation/manifest evidence, independent review and full four/four acceptance pass.
- [ ] Same-width control/candidate observations and remaining gaps are accurately recorded.
