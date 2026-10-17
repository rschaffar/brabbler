# Reviewed second-batch core file parallelism

## Goal

Validate and promote the nine lower-risk default-exclusive files from the completed read-only audit, preserving every case/assertion/deadline, serial cases within each file, the four-worker budget and failure/abort draining. Leave large-operations and model-speed-lifecycle exclusive. Measure rather than promise a wall-time gain.

## Context and authority

The user approved continuing with the nine-candidate recommendation. Worktree `perf/core-exclusive-batch2`, based on local `rst-main` `04a0ac6226c2bd697e3021fc4c80c98355c684cc`; parent is sole repository writer and test/Git coordinator. This authorizes bounded implementation/validation, not application fixes, integration, cleanup, publication or deployment.

Audit: `/tmp/pi-web-exclusive-audit.2vqjtqth/{AUDIT.md,audit.json}`. All nine audited test hashes match the current base and the timed `b9ba9b` input. One synthetic idle-timeout file is an F candidate; eight native Git/trust/RPC/filesystem files are N candidates. Their 81 original reported tests consumed 35.049s of serial file work in the retained run; this is not a predicted saving. The other two audited files (8.582s) and 94 unaudited defaults are outside this change.

## Plan Relationship

Follow-up to the archived `2026-10-16_core-test-parallelism-plan.md`, retaining its scheduler/schema and ADR 0025's three-level acceptance architecture. Older native/parallel acceptance plans contain completed historical work, not a competing active owner. Current operational rules and measured results belong in `docs/testing.md`; this plan owns only the nine-file allowlist expansion and its evidence.

## Plan

- [x] Verify audit inputs against clean current `rst-main`, create isolated worktree, initialize CodeGraph and read owning guides.
- [x] Freeze the unchanged control and execute complete fresh acceptance with `all --workers 4 --jobs 4`; retain source/package/toolchain/resource identity and separate preparation/runtime. Passed 296.227s; preparation 8.722s separately.
- [x] Add meaningful manifest-selection regressions; show the promotion contract fails against the old manifest while existing mechanics/held-file contracts pass. Red: 31 pass/one intended failure, 39.248s; green: all 32 pass, 37.288s; static pipeline passed in both.
- [x] Add exactly one F and eight N entries with file-specific isolation rationale and coarse historical priority hints; leave runner implementation, test bodies, deferred files and deadlines unchanged. Exact nine-entry delta and all prior entries/bodies checked; independent source review clear after wording and actual-heavy-priority regression corrections.
- [x] Run focused sandboxed contracts and an independently reviewed, instrumented native thirteen-file overlap proof (nine candidates plus four existing heavy Git files). Passed 384 unchanged native cases plus 32 E contracts, four active native files, zero inotify-visible source mutations and clean reported settlement; diagnostic instrumentation remains outside the repository and is not benchmark/full acceptance.
- [x] Obtain independent review of the bounded configuration/contracts/evidence and resolve material findings without expanding scope silently. Source and evidence-scope review found no blocker; wording/priority regression corrected. Native control-comparison receipt added; JS-wrapper negative branches are statically reviewed, not separately runtime-injected. Scope limitations accepted below.
- [x] Freeze the settled implementation, run all three complete fresh checks at the same four-worker budget, and compare with the control. Passed 255.502s versus 296.227s; exact evidence below. Preparation 7.525s versus 8.722s is separate.
- [x] Update `docs/testing.md`, record exact evidence/accepted gaps and retire this implementation plan. Proportional active-document checkpoint `/tmp/pi-web-batch2-doc-active.dx7A0h` passed all 76 local targets and native graph evaluation (4.374s); only two evidence documents changed and the application derivation matched. Archive-final checks/evidence commit belong to the Git handoff, not another full execution.
- [x] Hand off remaining evidence-commit history, completion intent, current-target composition, exact-state merge approval and separate cleanup to the global Git lifecycle. The implementation/acceptance scope is complete; no integration or cleanup authority is implied.

## Verification checkpoint

- Fresh control `/tmp/pi-web-batch2-control.t5ht9z`, source SHA256 `a86c173bb1bbb1d961afaf22acb857c172970049414495b1a62085c436722424`: complete 296.227s; core 292.028s, browser 216.875s, deployment 24.277s. All 308 files/2,404 tests/10 suites, 24 browser/terminal groups/53 receipts and deployment/settlement gates passed. Private native x86_64 execution, 32 logical CPUs, four effective core workers/four browser sandboxes, about 55 GiB available at browser admission; admission estimates are not reservations. Warm prerequisites; separate isolated preparation 8.722s. An earlier coordinator at `/tmp/pi-web-batch2-baseline.YovqIj` failed to load omitted `composition.json` before any Nix/test child; retained error and corrected fresh directory, not an application failure or benchmark result.
- Final red source `/tmp/pi-web-batch2-red-final.zE236Y`: original manifest plus the two new contracts, one intended promotion failure/31 passing cases, 39.248s. Both held-file fallback and original mechanics passed. Green `/tmp/pi-web-batch2-candidate.s1zeR4`, source SHA256 `9671c8d50ab571af247d417a8d59d8db69210eb4d4da56f97a2a7842d12f7b4b`: 32/32 contracts and static checks passed, 37.288s. Earlier unexecuted red drafts remain, not execution evidence.
- Diagnostic source `/tmp/pi-web-batch2-observed.ukTPF3`, SHA256 `8d24ffe026739377d5cf2830927818723b5a015631f983354a1e63003314651b`: ordinary runner/test bodies unchanged; only snapshot-local `nix/tests.nix` entry redirection and two observer scripts differ from the green source. Native inotify self-test passed in an ordinary Nix builder (1.092s), including transient restored writes/rename/delete/attribute events and a synthetic overflow veto. Neither instrumentation file is added to the repository.
- Instrumented native proof passed 115.337s: 14 files/416 tests (384 original native cases from nine candidates plus four heavy files, and 32 contracts), all original native registered/completed titles/outcomes/counts matching control. Peak four active native files; every candidate overlapped cleanup; E contract started after the entire pool. 1,126 source watches, zero observed source events/mutations, valid ready-to-final-drain receipt and clean reported worker/monitor settlement. Core `/tmp/pi-web-test-core.l94XbD`; output `/nix/store/wp3rwgg2clrar3axx37bil82mrglzibk-pi-web-core-checks`, summary `artifacts/run-zM0UOM/summary.json`, observer records `artifacts/batch2-observer-QhchiV/`. This is diagnostic evidence, not a performance benchmark or complete candidate acceptance. Scope excludes mmap/remote/hostile-host bypass, post-interval/unobserved descendants and RSS peaks; no resource reservation is claimed. Independent evidence-scope review found no blocking false-pass/authority gap. `/tmp/pi-web-batch2-observed.ukTPF3/control-comparison.json` now binds the control/native summary paths and hashes with per-file exact outcome comparisons; the reviewer did not independently recompute that parent-supplied comparison. The Python self-test does not runtime-inject every JS wrapper failure path. Ordinary complete acceptance passed separately below.

## Complete ordinary candidate acceptance

Tested implementation **`3a08b8ba3eab82f8ae0bc3f03fb16221449e9d25`**, based on **`04a0ac6226c2bd697e3021fc4c80c98355c684cc`**. Clean committed checkout exported and independently verified before ingestion; frozen source `/tmp/pi-web-batch2-full.YG0gK0/source`, content/mode SHA256 **`5df7dc43bd3db53463b61bbafcdc2a8204ffc4a8619513d1169d9f549bd0939c`**. Post-run source verification passed. Ordinary runner/entrypoint is unchanged and no observer script is present.

From that physical source directory: `nix run --no-write-lock-file --max-jobs 2 --cores 4 path:/tmp/pi-web-batch2-full.YG0gK0/source#test -- all --workers 4 --jobs 4`.

| Interval | Fresh control | Candidate |
| --- | ---: | ---: |
| Core | 292.028s | 251.489s |
| Browser | 216.875s | 213.847s |
| Deployment | 24.277s | 21.369s |
| Complete command | 296.227s | **255.502s** |

- **40.725s / 13.748% less complete wall time; 1.1594x faster.** One fresh warm-prerequisite pair, same application/toolchain/scenario inputs and four-worker budgets, no overlapping coordinator-owned checks. Model/review/coordination and separate isolated preparation **8.722s / 7.525s** are excluded. Neither cold-cache nor statistically repeated timing is claimed.
- **308 files / 2,406 tests / 10 suites passed**, none failed/skipped/cancelled/unstarted, no reported owned survivors or uncertainty. All 307 other file case/title/outcome/count sets exactly match control; all old unit titles remain with two new metadata cases (control 2,404 tests). Lane files **F157/N36/E115**; aggregate E work **135.568s → 102.206s**. All prior lane entries, 81 newly pooled cases and 303 heavy native cases retain their source bodies.
- **24 browser/terminal groups / 53 exact receipts** and every genuine Home Manager deployment, persistence/PTY, collection/hash and shutdown-settlement gate passed. The two deferred files remain E; the other 94 unaudited defaults are untouched. Core remains critical at 251.489s versus browser plus deployment 235.216s, about 16s apart.
- Core `/tmp/pi-web-test-core.WRGvPk`, output `/nix/store/5naxfsfhjb8jby1bxk52w0wbc03wqr1h-pi-web-core-checks`, `artifacts/run-NljTFz/summary.json`; browser `/tmp/pi-web-test-browser.LRTeD7`; service `/tmp/pwv-qKnbJA`. Root `/tmp/pi-web-batch2-full.YG0gK0` retains commands/logs/results, source/composition/metrics and preparation records. Core evidence tree validated (626 entries) before reading. Control records remain under `/tmp/pi-web-batch2-control.t5ht9z`.
- Identical package `/nix/store/gssd7v016ij45925lh2lwig72j8wcymm-pi-web-0.9.3`, pinned Node 24.21.0/TypeScript 6/Pi SDK 1.3, Chromium/fonts/tools. Native x86_64 host, 32 logical CPUs, four effective core workers/four browser sandboxes; about 55/57 GiB available at browser admission. Combined admission estimate remains 16 CPUs/27 GiB, not a reservation; no per-worker RSS peak or above-four-worker proof. Native ARM/CI are unverified.
- Subsequent guide/evidence/status/archive edits are documentation-only. Confirm unchanged executable inputs and application derivation with proportional final checks; do not represent this full execution as a run of a later evidence tip or merge. Exact-state Git composition/integration and cleanup remain separately governed by the global lifecycle.

## Scope and risks

No fixture-cost rewrite, new scheduling mechanism, larger worker budget, application behavior change or default-E blanket promotion. The synthetic idle test uses controlled clocks; the real 999/1000ms shutdown contract stays intact. Shared cwd/source is writable (`nix/tests.nix:44–52`), so private processes alone do not prove isolation. Jiti filesystem caching is disabled by the pinned runner; native proof still checks source mutations. Observations do not certify unobserved/escaped descendants or a hard memory reservation. Keep deliberate instrumented contention separate from ordinary browser/SDK acceptance. No retries, timeout inflation or failure suppression.

Keep `plugins/git-workflow/large-operations.test.mjs` E pending stronger timeout/descendant/resource proof, and `lib/session-model-speed-lifecycle.test.mjs` E pending asynchronous teardown proof. Their source is unchanged. Preserve every failed candidate and all historical evidence; do not reset/stash/clean unrelated work or change host services/permissions.

## Completion Checklist

- [x] Exactly nine reviewed promotions; all 81 original cases and the four heavy files' 303 cases unchanged.
- [x] Red/green contracts, native overlap/source/settlement proof and independent safety review recorded.
- [x] Complete core/static/plugin, all 24 browser/terminal groups/53 receipts and genuine deployment/settlement evidence passed for the exact implementation.
- [x] Measurement/control scope, source/package identity, resource assumptions, failures and known gaps accurately recorded in the maintained guide and this evidence record; active-checkpoint links/native graph/package identity passed, with archive-final checks retained separately.
- [x] Reviewable unsigned implementation commit `3a08b8ba3eab82f8ae0bc3f03fb16221449e9d25` and a truthful handoff of the final evidence commit/completion question to the separately gated global Git lifecycle; no remote publication or activation.
