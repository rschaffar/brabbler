# Review and prioritize parallel core tests

## Goal

Reduce complete acceptance wall time by reviewing the four expensive default-exclusive Git Workflow files for bounded file-level parallelism and scheduling long reviewed files first. Preserve every test/scenario, within-file serial execution, immutable Nix inputs, failure admission/draining, process settlement and original deadlines. The user authorized this bounded implementation after the measured optimization discussion; fixture-cost rewrites and production changes are not included. The additional narrowly scoped history-response matcher correction below was separately approved to unblock a valid baseline.

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
- [ ] Obtain independent source/safety review and freeze the settled candidate. Verify native graph and fresh complete core/browser/deployment acceptance with the same four-worker budget, without concurrent check jobs.
- [ ] Compare exact source/package identities, coverage, resource/admission observations and runtimes with the baseline. Update the testing guide and archive this plan after its implementation evidence/handoff is complete.
- [ ] Create reviewable unsigned feature history and resolve this task's completion intent through the Git lifecycle. Any local integration remains a separate exact-state non-FF approval into current `rst-main`; cleanup/publication are not implied.

## Evidence Ledger

- Baseline snapshot: `/tmp/pi-web-core-baseline.7pt57x/source`, content/mode SHA256 `2fb1cb044868dbc8766530c45e829a297b73bbe67726bb90abb09fd95297512e`, unchanged Git base above. Separate export/manifest verification passed. Prerequisites were realized in isolated Nix builders by a single sequential coordinator; exact preparation results are retained in `preparation.json`.
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

## Risks and Recovery

Parallel files still share the exported source cwd. Any source-relative write, fixed port, unscoped process signalling or shared mutable external state blocks promotion until isolated. Process-local globals do not by themselves require cross-file exclusivity. Latency-sensitive operations and unchanged 10-second waits must be proven under bounded normal load, not justified by a passing unchanged retry. Keep classification fallback E and preserve captured failures/uncertain workspaces. Resource estimates are not reservations; keep deliberate concurrency tests separate from ordinary SDK/browser acceptance and coordinate one test owner.

If audits or measurements reject a candidate, retain evidence and limit/revert only this task's own proposed changes in a reviewable follow-up. No host daemon configuration, installed-service contact, privilege widening, source-test omissions, deadline inflation, Git reset/clean/stash or historical artifact reaping is authorized.

## Completion Checklist

- [ ] Every promoted file has a concrete isolation rationale and passes real concurrent execution with unchanged cases/deadlines.
- [ ] Priority estimates are validated, deterministic and advisory; unknown files stay E, all tests run once and E never overlaps the pool.
- [ ] Failure/abort closes admission and drains owned started work with honest settlement/coverage evidence.
- [ ] Paired baseline/candidate native results and source/package bindings are recorded; complete three-level acceptance passes after review.
- [ ] Current findings live in the maintained testing guide; implementation history, remaining gaps and separately owned Git lifecycle are explicit.
