# Bounded parallel packaged-service acceptance

## Goal

Replace the measured 45m44s VM run with substantially faster complete acceptance: remove demonstrated duplicate scenario execution, split the long aggregate, and run independent groups in isolated bounded lanes inside one NixOS guest. Preserve every substantive assertion/input variant, original browser deadlines, actual production package and real Home Manager service behavior. Measure the resulting full run rather than claiming a theoretical speedup.

## Context and authority

The user explicitly requested implementation after rejecting the 45-minute runtime. Worktree `perf/parallel-nix-acceptance`, starting from local `rst-main` at `34ac894a7e2a048d881f4d61a4c76bc0939f38db`. One parent writer/test owner; independent agents supplied read-only coverage and isolation reviews. No deployment, remote publication or historical cleanup is authorized.

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

- [ ] Replace selector fallthrough with explicit scenario ownership; verify independent baseline coverage union, variant/order contracts and runtime completion receipts.
- [ ] Add deterministic lane planning, resource admission and timing contracts; test exact coverage, no duplicates, bounded concurrency and fail-closed evidence validation.
- [ ] Generate isolated Home Manager users/controllers and parallel runner supervision; retain per-lane activation, restart/persistence, cgroup and failure-collection proofs.
- [ ] Add fresh profile selection/combined execution and overlap independent CI jobs; preserve one verified source snapshot and immutable application identity.
- [ ] Run focused contracts and a real overlapping-lane proof; investigate exact failures without retrying unchanged work or increasing browser deadlines.
- [ ] Freeze and run complete core plus full VM acceptance; compare actual wall time with the baseline and record per-group/lane costs and hardware/budgets.
- [ ] Obtain independent safety/coverage review; update ADR and owning guides, commit reviewable history and resolve completion intent/exact-state local integration separately.

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
- Complete four-lane acceptance remains pending; no browser deadlines or console-error assertions have been relaxed.

## Completion Checklist

- [ ] Every reviewed old scenario/input variant has one explicit owner and passes complete acceptance.
- [ ] Multiple lanes run concurrently without shared UID/HOME/port/service-control state or weaker failure settlement.
- [ ] A measured full run is materially faster than 45m44s; remaining bottlenecks are quantified, not hidden by cached execution.
- [ ] Full core and VM acceptance pass; focused/estimated/cached evidence is labelled accurately.
- [ ] Current behavior and empirical results live in owning docs; exact-state Git and separate cleanup safeguards remain intact.
