# Bounded parallel packaged-service acceptance

## Goal

Replace the measured 45m44s VM run with substantially faster complete acceptance: remove demonstrated duplicate scenario execution, split the long aggregate, and run independent groups in isolated bounded lanes inside one NixOS guest. Preserve every substantive assertion/input variant, original browser deadlines, actual production package and real Home Manager service behavior. Measure the resulting full run rather than claiming a theoretical speedup.

## Context and authority

The user explicitly requested implementation after rejecting the 45-minute runtime. Worktree `perf/parallel-nix-acceptance`, starting from local `rst-main` at `34ac894a7e2a048d881f4d61a4c76bc0939f38db`. One active writer and one parent test/Git coordinator; delegated browser and component-test patches were bounded and written only while the parent paused. Independent agents supplied read-only coverage, isolation and lifecycle reviews. No deployment, remote publication or historical cleanup is authorized.

## Plan Relationship

Follow-up to `2026-10-15_nix-native-acceptance-plan.md`. Preserve ADR 0023's package, sandbox, snapshot, credential, guest-network and evidence boundaries. A new ADR replaces only its sequential single-user scheduling decision. The scheduling optimization does not change application behavior, real provider access, release policy or unrelated plans. After the first complete trial exposed a terminal cancellation race, the user explicitly authorized a bounded production lifecycle fix and deterministic regressions, retaining the existing browser assertions and deadlines.

## Architecture

- Explicit disjoint scenario owners, including viewport height, locale/preference and ordering variants. Split general into state/history/extension/mobile-action owners. Keep setup-dependent integration chains intact.
- A reviewed coverage inventory and runtime completion receipts prevent omissions and repeated scenario/input owners. Focused selections do not fall through into account/API/general work.
- One immutable package and one guest. Each lane has a distinct ordinary user, genuine Home Manager `pi-web.service`, fixed controller/UID/bus, port, environment file, HOME/state and evidence. No concurrent suites in one Node process or against one application service.
- A deterministic duration-weighted partition runs independent lane queues concurrently. Driver control remains serial; transient runner units own each suite/Chromium cgroup. Failure closes admission, drains started work, settles runner and application cgroups, and independently collects every lane.
- Profiles change only declared concurrency/resources, not coverage or deadlines. Fresh runs choose a bounded profile from effective CPU/memory; an explicit smaller profile supports CI. Core/VM independence can overlap without oversubscribing a single host.
- Per-group/lane timing and versioned evidence identify the exact selection, plan, package, collection and settlement. Any unsafe/incomplete lane vetoes VM-bulk cleanup.

## Baseline evidence

Verified source digest `fdcc72a0600ddd96b0db016609c2f4ce00e99c6bc924a4b4c17b1c68bfe33bee`, `/tmp/pi-web-nix-acceptance-rebased-WkVdPA/driver.log`, `/tmp/pwv-TY2arB/run.json`: 21 sequential groups 2,605.07s; VM script 2,627.03s; E2E command 2,744s. General alone 948.41s. Core command 387s (302 files/2,295 tests; four effective workers). Complete fresh commands totaled 52m11s, excluding model/coordination time. These are historical measurements, not a new-candidate run.

Coverage review found the fallback API/account preamble and account footer run repeatedly in most focused selectors, plus general repeats complete named helpers. Distinct locale, viewport-height, preference and chained mobile/archive variants must not be mistaken for duplicates.

## Plan

- [x] Replace selector fallthrough with explicit scenario ownership; verify independent baseline coverage union, variant/order contracts and runtime completion receipts.
- [x] Add deterministic lane planning, resource admission and timing contracts; test exact coverage, no duplicates, bounded concurrency and fail-closed evidence validation.
- [x] Generate isolated Home Manager users/controllers and parallel runner supervision; retain per-lane activation, restart/persistence, cgroup and failure-collection proofs.
- [x] Add fresh profile selection/combined execution and overlap independent CI jobs; preserve one verified source snapshot and immutable application identity.
- [x] Run focused contracts and a real overlapping-lane proof; investigate exact failures without retrying unchanged work or increasing browser deadlines.
- [x] Freeze and run complete core plus full VM acceptance; compare actual wall time with the baseline and record per-group/lane costs and hardware/budgets.
- [x] Obtain independent safety/coverage review; update ADR and owning guides, commit reviewable history and resolve completion intent separately.

The user selected preparation for local `rst-main` integration after complete acceptance. Rebase, final proportional evidence checks, exact-state merge approval and any cleanup remain separately guarded operations, not implied by these implementation checkboxes.

## Risks and recovery

CPU/RAM contention can invalidate normal browser deadlines; size/admit lanes rather than increasing deadlines. Resource estimates are not reservations. Preserve fixture and service acquisition ordering. Retain original failures, all incomplete lane diagnostics and uncertain VM bulk. A failed lane must not let another overwrite its evidence or acquire after final stop. Smaller concurrency uses the same definition and complete coverage, never a fallback environment.

The scheduling-only candidate retained the exact baseline package derivation `/nix/store/7b14a7f305ffcrm33ad5nm2j7gdz1f8x-pi-web-0.9.3.drv`. The subsequently authorized terminal lifecycle fix changes application input and requires a new isolated package build; it does not change dependency inputs. Native ARM and GitHub CI execution are not established by local x86-64 measurements.

## Trial findings and authorized correction

- The first four-lane complete trial, `/tmp/pi-web-parallel-candidate-O4KKER/complete.log`, failed after 483s: 13 groups passed before the terminal console-error assertion rejected a real 404; pending groups were not admitted and the coordinator aborted/awaited core. This is not a full acceptance pass or a benchmark result. Exact diagnostics are under `/tmp/pwv-zcbBzU/artifacts/guest/pi-web-evidence/l3/artifacts/terminal/`.
- Its trace records DELETE followed 1ms later by GET for the same terminal's event stream. Closing during held creation still called `connect()` after creation completed. The fix must prevent that subscription and disconnect existing streams before waiting for creation/input drain and DELETE, without changing unmount leases or failed-close retry semantics.
- `/tmp/pi-web-terminal-close-red-a9D3Fb/driver.log`: fresh sandboxed static pipeline passed; the actual transpiled component failed exactly the two new cancellation regressions, with nine other tests passing, in 45s. The earlier `/tmp/pi-web-terminal-close-red-9bkZeT/driver.log` stopped at a test-local ESLint variable-name error, corrected before this meaningful red run.
- `/tmp/pi-web-parallel-final-Rif9j2/green-core.log`: all 11 component/client tests and static pipeline passed in 44s. `focused-terminal.log`: packaged terminal, both configured Home Manager activations and used-lane restart/persistence passed in 199s, including realization of the changed production package; VM script 61.39s. Independent focused review found no blocking lifecycle/test-double issue.
- The next four-lane/core-four-worker complete trial in that root failed after 493s: 303/304 core files passed, with one ordering-test failure and nine downstream failures in `plugins/session-launch/runtime.test.mjs`; the coordinator aborted/awaited VM after 16 passing groups, including terminal. The held extension-shutdown gate outlasted the genuine one-second refused-prompt fallback during an uncached HMR import and independent SDK construction. This is not a complete acceptance pass or benchmark.
- Make that ordering test control only the synchronously armed retirement timer, restoring real timers before the HMR import. Keep every alias/HMR/independent-ID/order assertion and the unchanged separate 999/1000-ms fallback proof. Release and await gated work in `finally` even when assertions fail. This is fixture determinism, not a longer production or browser deadline. Preserve its existing E/core-exclusive classification explicitly.
- `/tmp/pi-web-parallel-ordered-6oVhZk/focused-core.log`: all 49 real SDK/ordering and shutdown tests plus the static pipeline passed in 57s. Independent follow-up review found no blocking timer-capture or cleanup issue. The complete corrected candidate then passed as recorded below; no browser deadlines or console-error assertions were relaxed.

## Complete verification and measured result

Tested implementation commit: `da8b3ef8c721fca0c81640b822329ea0b00c2339`, including the separately reviewable terminal fix `235a8e58d198ec9ebf41dc930a17e4a98f7d0683`. A new verified export of the live worktree matched the full-tested source content/mode SHA256 `c3f891597c3ccf4db9b8fff20386fb6ba2bbd371531ab516e923d1c09ecdfb7f` before commits; commit metadata does not enter this export. This subsequent plan/testing-guide update is evidence-only, not a claim that the full suite ran again on its later tip.

From `/tmp/pi-web-parallel-ordered-6oVhZk/source` (both physical CWD and frozen flake):

```sh
nix run --no-write-lock-file --max-jobs 2 --cores 4 \
  path:/tmp/pi-web-parallel-ordered-6oVhZk/source#test \
  -- all --workers 4 --jobs 4
```

- **Passed in 658s (10m58s)** command wall time, versus the historical 3,131s (52m11s): **4.76× faster / 79.0% less wall time**. Model work, review/coordination and the earlier isolated package build are not included.
- Core: **304/304 files, 2,333/2,333 tests, 10 suites**, no skips/cancellations/unstarted files, surviving observations or settlement uncertainty; **483.40s** outer execution. `/tmp/pi-web-test-core.9lVrJx/run.json`; output `/nix/store/jra780nppcikcmc6vb2cml8lv1f8g91g-pi-web-core-checks` retains full artifacts/lifecycle.
- VM: **24/24 groups, all 53 scenario/input receipts** (52 browser plus terminal), four genuine Home Manager activations and four used-lane restart/persistence proofs. Collection, synthetic symlink rejection probe, runner and application settlement all passed. **654.94s (10m55s)** outer execution versus 2,744s (45m44s); driver reported **602.37s**. `/tmp/pwv-GeFAXX/{run.json,artifacts/acceptance.json}` and `artifacts/guest/pi-web-evidence/` retain diagnostics. Only this settled run's pinned runtime/tmp/cache bulk was removed.
- One public source export `/tmp/pi-web-test-source-WdEDVV/source` and `selection.json` record four lanes/eight guest vCPUs/16 GiB, four core file workers and overlap. Same native x86_64 host: 32 logical CPUs; admission saw about 50.8 GiB available memory. Combined conservative admission required 16 CPUs/27 GiB including prerequisite-build peaks, not a resource reservation. Guest state disk remains 16 GiB sparse.
- Core grew from 387s to 483s while overlapping VM; that contention cost is included in the complete wall time. Dependencies and the already isolated-built package were reused, but both nonce-keyed sandboxed core and regular VM execution were fresh. This is not a cold-cache or CI measurement.
- The focused terminal and full corrected run used the identical package `/nix/store/pccrf8s0s0gvv9d1wj6h3gxpg9yc1ig0-pi-web-0.9.3`, derivation `/nix/store/fw5q48k9scl7zdzdzp4psz2yjdnybjh7-pi-web-0.9.3.drv`. Shared dependencies remain `/nix/store/ahlnaz2n8y7xsip15r2ang3ihmqazwl9-pi-web-node-modules-0.9.3`.
- `nix flake check --no-build --no-write-lock-file -L`: native graph passed in **5s**, `flake-check.log` in the frozen root. Other systems were omitted, not tested. Native ARM, GitHub execution and cold-cache performance remain unverified.

### Actual queue costs

All four first groups started within 0.23s; every lane remained active until at least 428.10s after driver start. Group elapsed sums total **1,839.35s**, versus 2,605.07s in the old inventory. These are elapsed observations under different scheduling, not a pure CPU-time or duplicate-removal attribution.

| Lane | Group work sum | First start / last finish (driver seconds) |
| --- | ---: | ---: |
| l0 | 552.14s | 25.04 / 578.86 |
| l1 | 400.60s | 25.11 / 428.10 |
| l2 | 461.26s | 25.19 / 488.71 |
| l3 | 425.35s | 25.26 / 453.05 |

| Group | Seconds | Group | Seconds |
| --- | ---: | --- | ---: |
| git-plugin | 281.36 | history | 62.91 |
| privacy | 95.48 | worktrees | 185.28 |
| file-edit | 72.39 | extension-dialogs | 64.40 |
| accounts | 51.54 | state | 16.56 |
| appearance | 41.01 | session-launch | 45.60 |
| session-links | 10.37 | running-forks | 25.85 |
| activity | 172.41 | questions | 155.81 |
| model-speed | 147.33 | markdown | 161.64 |
| diff-context | 71.98 | mobile-sidebar | 25.83 |
| move | 37.70 | terminal | 57.94 |
| bulk | 14.89 | archive | 6.67 |
| timestamps | 16.96 | trust | 17.46 |

The slowest group is Git plugin (281.36s); the longest lane exceeds the shortest work sum by 151.54s. Reviewed initial weights therefore are not an optimality claim. No further scaling or hypothetical rebalancing benefit is presented as measured acceptance.

## Completion Checklist

- [x] Every reviewed old scenario/input variant has one explicit owner and passes complete acceptance.
- [x] Multiple lanes run concurrently without shared UID/HOME/port/service-control state or weaker failure settlement.
- [x] A measured full run is materially faster than 45m44s; remaining bottlenecks are quantified, not hidden by cached execution.
- [x] Full core and VM acceptance pass; focused/estimated/cached evidence is labelled accurately.
- [x] Current behavior and empirical results live in owning docs; exact-state Git and separate cleanup safeguards remain intact.
