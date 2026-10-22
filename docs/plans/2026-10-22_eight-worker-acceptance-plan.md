# Eight-worker acceptance benchmark

## Goal

Run fresh complete acceptance with eight core workers and eight browser sandboxes, overlapping only when conservative CPU/memory admission permits. Measure actual widths, preparation, execution and complete command time; preserve all coverage, deadlines, isolation and failure/settlement checks.

## Context

The user requested an 8/8 test and explicitly selected preparing it now and waiting for sufficient RAM rather than serializing levels. Dedicated worktree `test/acceptance-eight-workers` starts at local main `c19cf2ab8b5dc9dd7d8936d30120b0a62a69ea75`. Main and installed services remain untouched. Initial host observation: 32 logical CPUs, about 41 GiB available RAM; overlapping 8/8 requires at least 51 GiB and conservative realization CPU accounting. No stopping unrelated processes, remote operations, or admission bypass is authorized.

## Plan Relationship

This is a bounded follow-up to the completed Nix-native/parallel acceptance plans and ADR 0025. It preserves the three-level architecture, four/four default guidance and existing queue/coverage definitions. It does not reclassify exclusive tests, change application behavior, implement dynamic queues or relax acceptance policy.

## Plan

- [x] Enable explicit browser widths through eight while preserving the default cap of four; verify parser, planner, eight-way dispatch and resource-refusal contracts.
- [x] Allocate up to eight core Nix cores for explicit wider selections and account for actual realization peaks and core-worker memory in overlap admission; exact boundary contracts pass. Real effective eight-worker evidence remains part of the full benchmark below.
- [x] Independently review the bounded harness changes and run focused sandboxed contracts.
- [ ] Wait for sufficient effective CPU/memory, freeze source writers and execute fresh `all --workers 8 --jobs 8`; retain the exact source, requested/effective widths, command/preparation/execution timing and diagnostics. Do not retry a failed test unchanged or silently serialize this requested overlapping benchmark.
- [ ] Record the measured result or explicit blocker; retain unintegrated resources until complete verification and separately approved integration/cleanup.

## Preparation evidence

Focused command from this worktree: `nix run --no-write-lock-file .#test -- core --jobs 4 --file lib/nix-vm.test.mjs --file lib/nix-browser.test.mjs --file lib/nix-test.test.mjs --file lib/test-runner.test.mjs`. Passed 79 tests across four files, 29 exporter contracts, type generation/typechecking/lint, with zero skipped/cancelled tests or uncertain settlement. Two existing lint warnings in `components/ReviewFileBrowser.tsx` are unchanged. Complete command wall time was 160s; the inner core invocation was 144.309s, with test-file execution only near its end. This focused run is not full acceptance or an 8/8 performance benchmark. No deliberate prerequisite prewarming was performed.

Evidence: `/tmp/pi-web-eight-focused.Y4vIFT.log`, `/tmp/pi-web-test-core.VqAIQI/run.json`, store output `/nix/store/dbz5az8fc6pjjx56yzn24zkjyh2lk1dl-pi-web-core-checks`. Independent read-only review found no blockers; actual Nix allocation and real eight-sandbox overlap still need runtime proof.

The guarded benchmark workspace is `/tmp/pi-web-eight-benchmark.46tqcT`. It will retain a verified source snapshot, resource-wait status/events and the full driver log. Wait for at least 32 effective CPUs, 51 GiB effective available memory and low observed host load; the benchmark must recheck real admission before launching levels, never substitute synthetic resources. Waiting is bounded to 60 minutes; expiration retains the prepared candidate and reports a blocker, not a test failure or pass. No automatic retry after test launch.

## Risks

Admission estimates are not reservations. More concurrency can expose contention or latent races; preserve original failures and do not extend deadlines or suppress errors. Current RAM headroom may block launch. Historical four/four timings are not a matched control for current source.

## Completion Checklist

- [x] Focused runner contracts and independent review pass.
- [ ] Full fresh acceptance records actual eight-worker core and eight-sandbox browser execution, complete coverage, deployment and settlement, or explicitly remains blocked/failed.
- [ ] Evidence distinguishes preparation, test execution, end-to-end runtime and unmeasured speedup claims.
