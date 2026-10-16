# Review and prioritize parallel core tests

## Goal

Reduce complete acceptance wall time by reviewing the four expensive default-exclusive Git Workflow files for bounded file-level parallelism and scheduling long reviewed files first. Preserve every test/scenario, within-file serial execution, immutable Nix inputs, failure admission/draining, process settlement and original deadlines. The user authorized this bounded implementation after the measured optimization discussion; fixture-cost rewrites and production changes are not included. The additional narrowly scoped history-response matcher correction below was separately approved to unblock a valid baseline.

## Status

Implementation, independent review and complete native acceptance are complete.
The user chose **Prepare local integration into rst-main** after the paired result.
This completed implementation plan hands exact-state approval, unsigned non-FF
local integration/result verification and separately gated cleanup to the global
`git-worktrees` lifecycle. Those Git operations are not claimed complete by this
archive; publication, host activation and historical evidence/backup disposal
remain outside scope.

## Context and Plan Relationship

Use `perf/core-test-parallelism` in the dedicated linked worktree, starting from local `rst-main` at `a2cc0ebcc85fa1a3ac539b3f4a675ad032335097`. CodeGraph was initialized there before research/edits. The completed browser/deployment split and ADR 0025 own the three acceptance boundaries; this plan changes only the existing core review/scheduling policy. SDK/toolchain, Mermaid, browser coverage and deployment behavior remain owned elsewhere.

The earlier Node 24 complete run took 418.482s, including core 414.029s and browser/deployment approximately 245s. Exclusive core work summed 342.581s. Cleanup/discard/server/project-management consumed 85.606/48.641/31.054/26.736s, respectively. They were unreviewed-default E, not explicitly documented exclusive requirements. These are historical measurements, not a new-candidate performance claim.

Initial read-only review found private fixture repositories/agent state and process-local globals, but shared source cwd and transitive effects still need audit. The four files' total 192.037s is an opportunity, not a promised saving. Jiti imports happen once per file; retained TAP attributes only roughly 1–2s per heavy file outside top-level test bodies, so import caching is not the initial target.

## Plan

- [x] Freeze/verify a current-base snapshot with the separately approved fixture correction and run fresh complete acceptance with four core workers/four browser sandboxes. Corrected baseline passed in 417.385s; preparation is separate and no other check run overlapped.
- [x] Audit filesystem/Git effects in cleanup/discard and host/session/process effects in server/project-management, including transitive helpers. Independent reviews approve all four for N at file granularity, with private roots/process-local state and no identified shared source write, fixed port or peer signal. Keep cases serial and unknown files exclusive; actual load/timing proof remains below.
- [x] Add meaningful scheduler/schema regressions and verify their red behavior before implementation. All five new cases failed against the original runner while 25 existing cases/static passed (38.177s); cover estimates, deterministic priority/ties, E order/result order and failure/abort draining using deferred gates, not sleeps/native-work substitutes.
- [x] Add optional positive-safe-integer `estimatedMs` (omission becomes zero) and longest-first/canonical-path scheduling only within F/N. Estimates affect order, never coverage, authority or budgets. Keep E order/results inventory and fail-stop/drain semantics; all focused contracts passed.
- [x] Verify focused runner contracts and all four unchanged real Git files concurrently in an ordinary Nix sandbox. Six files/374 cases passed in 120.877s; all four native files overlap for 26.344s with no observed survivors/uncertainty, and E starts only after their drain. Deadlines unchanged.
- [x] Obtain independent source/safety review and freeze the settled candidate. Native graph passed in 4.215s and complete core/browser/deployment acceptance passed in 291.599s on the same four-worker budget, without another check job overlapping.
- [x] Compare exact source/package identities, coverage, admission observations and runtimes with the baseline: only the five expected optimization/test/docs paths differ, with 1,108 other entries and the application derivation unchanged. Current behavior/results are handed to docs/testing.md; archive this completed implementation evidence.
- [x] Create reviewable unsigned history (separate fixture correction and core optimization) and resolve completion intent: the user selected preparation for current-`rst-main` integration. Exact-state non-FF approval/integration/result checks and separate cleanup now belong to the global Git lifecycle; publication is not implied.

## Evidence Ledger

- Initial baseline attempt (failed): `/tmp/pi-web-core-baseline.7pt57x/source`, content/mode SHA256 `2fb1cb044868dbc8766530c45e829a297b73bbe67726bb90abb09fd95297512e`, unchanged Git base above. Separate export/manifest verification passed. Prerequisites were realized in isolated Nix builders by a single sequential coordinator; exact preparation results are retained in `preparation.json`.
- Baseline command, physical cwd inside that snapshot: `nix run --no-write-lock-file --max-jobs 2 --cores 4 path:/tmp/pi-web-core-baseline.7pt57x/source#test -- all --workers 4 --jobs 4`. It runs from immutable inputs while the sole repository writer prepares changes; only read-only audit agents run alongside it.

### Baseline obstruction and approved fixture correction

- The unchanged base's complete run failed after **119.028s**, before optimization execution. History's broad `/context` matcher accepted the late initial page (first user 4950) as the requested older page (expected 4900); its next response wait timed out. Exact native trace/capsule remains `/nix/store/n55yykj0r7q71drbbghx42g7xv7gny88-pi-web-browser-history-diagnostics`. Browser admission closed/drained peers; core was interrupted and deployment never started. This failed trial is not a usable performance baseline.
- The user explicitly selected **Fix the matcher and continue**. Extracted the legacy matcher and added four regressions: red proof `/tmp/pi-web-core-priority-red.wQ6FdH` passed static and 39 harness cases, failed exactly two new initial-page/wrong-cursor cases in **38.614s**. Fail-stop correctly left the selected runner file unstarted. A separate `/tmp/pi-web-core-scheduler-red.meynl5` then proved all five scheduler/schema cases red, **25 existing pass / 5 new fail**, static passed, **38.177s**, no survivors/uncertainty.
- Bound the two original scroll waits to their exact `before` cursors. No application change, response mock, skip, action/coverage reduction or deadline alteration. Fixture-only source `/tmp/pi-web-history-matcher-proof.0wa8pp` passed all **41 harness cases/static in 37.995s** and real desktop/mobile history in **25.323s**.
- Fixture correction committed separately at `90b3a40f914f075f6a11bff1133e545178be6920`. The corrected complete baseline is `/tmp/pi-web-core-baseline-fixed.uPHFA0/source`, content/mode SHA256 `4c4360d20ee70211948d7533c2c61704cac8f35575093488ef0543243ea13a9c`. All **985 exported file contents match that commit's blobs**; its performance runner/manifest are unchanged from the original base. Both baseline/candidate use this same fixture fix. No second test run overlaps the measured baseline.
- Source/transitive audits approved all four native files; cleanup/discard's 21 traced helpers and server/project host registries keep mutation under private fixture/agent/TMP or process-local maps. Owned signalling is child/group-scoped. Preserve 10-second operation waits, 15-second management calls and serial within-file globals/mocks. Native concurrency/load evidence is still required.

### Accepted baseline and focused candidate

- Corrected baseline at `90b3a40f914f075f6a11bff1133e545178be6920` passed **417.385s** complete: **308 files / 2,399 tests / 10 suites**, all **24 browser/terminal groups / 53 receipts**, all genuine deployment proofs and settlement/hash gates. Core **414.377s**, browser **226.879s**, deployment **23.512s**; serial E work **335.713s**. Artifacts: `/tmp/pi-web-core-baseline-fixed.uPHFA0/metrics.json`, core `/tmp/pi-web-test-core.k5C4dq`, browser `/tmp/pi-web-test-browser.LrTCDL`, guest `/tmp/pwv-FtcDeU`. Exact core output `/nix/store/q202m1q5vjys48j74g34an6inpxr34jq-pi-web-core-checks`.
- Baseline's four native files retained **133/97/38/35** cases and took **85.715/45.667/25.136/29.981s** for cleanup/discard/project-management/server. Historical rounded priority weights **90k/50k/30k/35k ms** are advisory. No plugin test body or production file is changed.
- Focused candidate `/tmp/pi-web-core-priority-focused.Uam4Ag/source`, digest `679c1259039ca32c79bf93692dd317b449951eb577d7c394da05f13cef29e7de`, passed six selected files/static in **120.877s**, **374/374 tests**, with the same native **133/97/38/35** cases and all 41 harness/30 runner contracts. Core output `/nix/store/iy259mrn1y6cy1v64vx3c09b96pnbs31-pi-web-core-checks`, `artifacts/run-ZlSj05/summary.json`; host receipt `/tmp/pi-web-test-core.wBfjeM/run.json`.
- Independent source review found no blocker. Strengthened its two nonblocking test observations: failure/abort checks now yield an event-loop turn while peers remain gated, and real two/eight-worker mechanism fixtures assert positive estimate propagation and weighted E isolation. These mechanism probes do not certify higher-width SDK/browser load.
- The focused run is not full acceptance or a speedup benchmark: no concurrent browser work/full remaining core corpus was present. Complete candidate acceptance/comparison remains open. Native x86_64 host, 32 logical CPUs; same requested/effective four core workers and four browser sandboxes for paired complete runs. Resource budgets remain estimates, not reservations; cold-cache, native ARM and CI execution are unverified.

### Complete optimized candidate

- **Tested implementation:** `6e3576c1cc69cc0c387d098ecb570e834344356b`; frozen source `/tmp/pi-web-core-priority-full.VIUnwY/source`, content/mode SHA256 `b1680c08cd07721f17326c1219cb8f9e70ae6cca0a39e420013c03425dc61cf8`. Separate export/manifest verification and post-run live-source verification passed.
- Exact command, with physical cwd inside that export:

  ```sh
  nix run --no-write-lock-file --max-jobs 2 --cores 4 \
    path:/tmp/pi-web-core-priority-full.VIUnwY/source#test \
    -- all --workers 4 --jobs 4
  ```

- **Result:** exit 0, **291.599s (4m52s)** versus baseline **417.385s (6m57s)**: **125.786s saved, 30.14% less wall time, 1.431x faster**. Exact commands, logs, source/package comparisons, metrics and graph results remain under that root. Native graph evaluation passed in **4.215s**; no non-native execution is claimed.
- **Core:** **287.462s** versus **414.377s**, **308/308 files / 2,404 tests / 10 suites**, all passed, no skipped/cancelled cases or observed survivors/settlement uncertainty. Baseline had 2,399 cases; the five additions are scheduler regressions, not removed work. Receipt `/tmp/pi-web-test-core.LIk2dZ/run.json`; output `/nix/store/n89qg0pkqcz7yiwwgbqksgyzq3zfbcvl-pi-web-core-checks`, `artifacts/run-RZftNg/{summary,inventory}.json`.
- **Browser:** **215.217s** versus **226.879s**, all **24 groups / 53 exact scenario receipts**; `/tmp/pi-web-test-browser.mZwYTz/run.json`. Scenario inputs, rendering changes already present in the local base and the approved history fix are identical across the pair. No browser/application source was changed by the optimization.
- **Deployment:** **21.722s** versus **23.512s**, `/tmp/pwv-lwazW1/run.json`; every genuine activation/environment/permission/persistence/PTY proof, service/cgroup/TCP settlement, host-only sentinel and artifact/hash gate passed. Only that invocation's verified runtime/tmp/cache bulk was removed; diagnostics remain.
- **Actual priority/isolation:** first four starts were cleanup/discard/server/project-management. Their full-run durations **103.749/56.479/39.737/34.833s** were individually slower under contention than baseline, but their real overlap was **34.833s** and E waited for the entire F/N pool. Every native file retained **133/97/35/38** original cases and byte-identical bodies. Serial E work fell **335.713s → 135.634s**. Do not attribute the whole gain to faster individual tests or separately quantify classification versus ordering without another experiment.
- **Identity/budget:** source comparison has exactly five changed paths (runner, lane manifest, runner regressions, testing guide, this plan), with **1,108 unchanged entries**. Both use `/nix/store/larzh9nxn2nzlc3v48ny6zmfcc4yk1am-pi-web-0.9.3.drv`. Same pinned Node 24.21.0/TypeScript 6.0.3/SDK 1.3.0 and Nix inputs. Native host **32 logical CPUs / about 54 GiB available** at browser admission; core requested/effective **4**, browser width **4**, aggregate estimate **16 CPUs/27 GiB**, not a reservation. Guest remains **1 vCPU/1536 MiB/2 GiB sparse disk**.
- **Timing scope:** prerequisites were warm and every core, browser capsule and guest executed freshly. No other coordinator-owned check job overlapped either measured run. Command time excludes earlier preparation, model/review/coordination and the preserved failed/red trials. This is one measured pair on shared hardware, not a cold-cache or statistical/machine-exclusive guarantee. Native ARM, CI and heavy widths beyond four remain unverified.

Current mechanisms and empirical findings live in `docs/testing.md`; ADR 0025's
acceptance boundaries remain unchanged. The completed plan is archived after this
handoff. Final evidence-only/archive checks are reported separately, not relabelled
as another full execution at the later documentation-only tip.

### Current-target composition after stale approvals

Two merge proposals returned stale before any Git effect. Read-only revalidation
then found local `rst-main` had advanced to `369555b6e72a5d7e8ec040954e73f184de9c08d7`
through an independently approved Git Explorer row-alignment change and stronger
browser geometry checks. Old approvals were not reused and no manual merge or
permission change was attempted.

- Rebased cleanly to **`b9ba9bdbc313fdeff73e6006ab06cc16cb0b950e`**; all three feature patches remain `=` in the range-diff. Only the four expected incoming component/browser geometry files differ from the earlier verified tree; they exactly match the new target. Core optimization and original paired evidence remain unchanged.
- Frozen source `/tmp/pi-web-core-priority-composed.Ay1l0g/source`, content/mode SHA256 **`228aca575373e254364c149fab3b2c3bd60a637f38e77a404c375da366ab973d`**. Separate export/verification and pre/post-run source checks passed. Package/support and driver preparation passed in **8.293s**, recorded separately; native graph evaluation passed in **4.414s**.
- Fresh complete command, physical cwd in that snapshot: `nix run --no-write-lock-file --max-jobs 2 --cores 4 path:/tmp/pi-web-core-priority-composed.Ay1l0g/source#test -- all --workers 4 --jobs 4`.
- **Passed 305.067s (5m05s)**: core **300.971s**, browser **227.386s**, deployment **22.969s**. All **308 files / 2,404 tests / 10 suites**, **24 browser/terminal groups / 53 exact receipts**, genuine deployment proofs and settlement/hash gates passed; no skipped/cancelled tests. This verifies the newly composed application/assertions, not a replacement for the earlier 417.385s → 291.599s performance pair.
- Evidence: complete logs/commands/results, composition/range-diff, source manifest and `metrics.json` under `/tmp/pi-web-core-priority-composed.Ay1l0g`; core `/tmp/pi-web-test-core.69wUgQ`, output `/nix/store/33i0y873bdskcighz8sfrdziy9s68n9z-pi-web-core-checks`, `artifacts/run-sGgK5P/summary.json`; browser `/tmp/pi-web-test-browser.drg1Fr`; deployment `/tmp/pwv-ybxz6R`.
- Package `/nix/store/gssd7v016ij45925lh2lwig72j8wcymm-pi-web-0.9.3`, unchanged toolchain/worker budgets, native 32-logical-CPU host; about 56 GiB available at browser admission. Warm prerequisites, fresh executions. A final documentation-only checkpoint and its proportional checks remain separate from this full run; exact-state Git integration/cleanup still belongs to the global lifecycle.

## Risks and Recovery

Parallel files still share the exported source cwd. Any source-relative write, fixed port, unscoped process signalling or shared mutable external state blocks promotion until isolated. Process-local globals do not by themselves require cross-file exclusivity. Latency-sensitive operations and unchanged 10-second waits must be proven under bounded normal load, not justified by a passing unchanged retry. Keep classification fallback E and preserve captured failures/uncertain workspaces. Resource estimates are not reservations; keep deliberate concurrency tests separate from ordinary SDK/browser acceptance and coordinate one test owner.

If audits or measurements reject a candidate, retain evidence and limit/revert only this task's own proposed changes in a reviewable follow-up. No host daemon configuration, installed-service contact, privilege widening, source-test omissions, deadline inflation, Git reset/clean/stash or historical artifact reaping is authorized.

## Completion Checklist

- [x] Every promoted file has a concrete isolation rationale and passes real concurrent execution with unchanged cases/deadlines.
- [x] Priority estimates are validated, deterministic and advisory; unknown files stay E, all tests run once and E never overlaps the pool.
- [x] Failure/abort closes admission and drains owned started work with honest settlement/coverage evidence.
- [x] Paired baseline/candidate native results and source/package bindings are recorded; complete three-level acceptance passes after review.
- [x] Current findings live in the maintained testing guide; implementation history, remaining gaps and separately owned Git lifecycle are explicit.
