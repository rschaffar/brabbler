# Session move acceptance blocker investigation

## Goal

Establish evidence for the Activity fixture's transport reset before choosing a
correction, then verify move-default fix `030f42e` and prepare the composed
candidate for the separately approved Git integration lifecycle.
The user explicitly chose transport-causation investigation before replacing
`route.fetch()` with a gated native browser request.

## Context and plan relationship

- The move implementation starts from main `96802b0` in the dedicated
  `fix/session-move-default-selection` worktree. Focused static/core (10 tests) and
  installed desktop/mobile move chains pass at source digest
  `05c14c5f6c1d102ac11bee7c518a5965220e0235daea4971c481b5e111198d30`.
- Full `nix run .#test -- all --workers 4 --jobs 4` failed in Activity's initial
  `route.fetch()` GET `/api/acceptance`, before its delivery gate. Browser driver
  ran 217.398s including 8.715s support/manifest preparation. Core was interrupted
  by peer failure; deployment did not run. Evidence:
  `/tmp/pi-web-test-browser.E39I8M/run.json`,
  `/tmp/pi-web-test-core.L7NKYp/run.json`,
  `/tmp/pi-web-move-defaults-all-v2.log`.
- The crashed builder's private server artifacts are inaccessible; do not widen
  permissions or clean its retained build. A keep-alive socket race is only a
  hypothesis. The separate owned-route rejection propagation can explain the
  fixture-process crash, not the original reset.
- The Activity client-ownership pilot plan owns a separate feature migration.
  This investigation does not migrate Activity, change scenarios/deadlines,
  suppress console/HTTP errors, or authorize an unchanged acceptance retry.

## Plan

- [x] Inspect exact failure, fixture ordering, actual route and pinned Playwright
  callback/HTTP behavior; independent review confirms reset causation is unknown.
- [x] Create a disposable source-only diagnostic snapshot of committed `030f42e`;
  instrument client socket reuse/close/error and server generation/socket events
  without changing request transport, retries or application behavior.
- [x] Execute the unchanged whole Activity scenario with diagnostics in its ordinary
  Nix sandbox. Retain command/source/timing/log identities; a pass alone is not a fix.
- [x] Analyze observed events, distinguish direct evidence from hypotheses, and
  obtain a decision if evidence is insufficient or correction changes scope.
- [x] Implement only an evidence-supported, separately reviewable correction;
  prove relevant failures and settlement using focused checks and review.
- [x] Obtain complete candidate acceptance and prepare the composed candidate for
  exact-state local main/non-FF merge approval. Cleanup/publication and actual
  integration execution remain separate Git operations, not inferred from this plan.

## Diagnostic evidence

All probes used source-only snapshot `/tmp/pi-web-move-transport.nHzbGS`, selected
through the feature checkout's `#test` entry point, with ordinary isolated Nix
builders and the unchanged production package `c6qzhz81zrpkgvc58zq1dmrn3bq2996p`.
No instrumentation was applied to the repository application or installed service.
The temporary snapshot and immutable exported sources preserve probe definitions.

1. Unchanged scenario plus socket/server diagnostics: Activity passed, **210.689s
   driver / 202.189s capsule**, with **7.839s support/manifest preparation**.
   `/tmp/pi-web-test-browser.Ot9DLG/run.json`, source `02dhbz9q143w4cg93zax5m6cyqm7l3j2`,
   log `/tmp/pi-web-move-transport-diagnostic.log`. All three initial status reads
   reused sockets with about 4.8–5.4s idle time. Server advertised a 5s keep-alive
   timeout and used a 1s close buffer. No reset occurred: this is not a fix.
2. A deliberate **6.5s client-event-loop stall before submitting** the next request
   did **not** reproduce the reset: Playwright/Node processed the old socket's close
   before allocating a new socket. This retracts any assumption that an arbitrary
   long event-loop pause is sufficient. **216.822s driver / 208.013s capsule**,
   **8.149s preparation**; `/tmp/pi-web-test-browser.BihwL8/run.json`, source
   `g24w4bg8kbl29mkqf72mz2dwp9d6xfqb`, log `/tmp/pi-web-move-transport-stall.log`.
3. A controlled **6.5s stall after Playwright's HTTP request allocated a reused
   socket, before its write**, reproduced `ECONNRESET` with no retry. Server and
   client logs bind the same TCP port `32942`: response finished `12:39:28.437Z`,
   server timed out/closed at `12:39:34.438Z`, client resumed/wrote at
   `12:39:34.939Z` and failed at `.940Z`. Server received no second request on that
   socket. A separate fresh-socket control received HTTP 200 while the same server
   generation remained alive. This proves a stale-reuse failure mechanism, **not
   that this artificial stall occurred in the original failed run**. The spike
   intentionally stopped after its control, so its failed/incomplete Activity
   result is not acceptance evidence. **75.250s driver / 67.059s capsule**, **7.667s
   preparation**; `/tmp/pi-web-test-browser.TtEcpN/run.json`, source
   `axa6ws4acx6sqf43qid8j4fmh8h6qqah`, log
   `/tmp/pi-web-move-transport-reuse-stall.log`. Paired server evidence:
   `/nix/store/7h3n0gypbkk9zx1fp8qffbhpimr07xzn-pi-web-browser-activity-diagnostics/artifacts/server.log`.

Original-run attribution remains unknown because its pre-reset socket/server
history was not recorded in accessible evidence. After receiving this explicit
boundary and the controlled reproduction, the user chose **Fix the reproduced
hazard**, authorizing a bounded correction, not a claim of historical causation
or an acceptance waiver.

## Correction and regression evidence

`openAcceptanceWithHeldStatus` now uses the existing `holdBrowserRead` owner after
navigation and before opening Acceptance. It holds/continues Chromium's original
GET, observes actual JSON consumption, and restores the observer before later
navigation. The fixture no longer performs a pooled `route.fetch()`/fulfill copy.
Application/runtime code, scenarios, status bodies, deadlines, general error
collection and the broader owned-route callback helper remain unchanged.

- Focused core: **16 tests passed** in `lib/browser-suite-fixtures.test.mjs` and
  `lib/project-acceptance-fixture.test.mjs`, with static evidence:
  `/tmp/pi-web-test-core.QmF3uZ/run.json`. New VM-double cases assert loading
  before continuation, exactly one original response/body, no second fetch/copy,
  HTTP503 failure propagation, joined unroute and restored observer. Both files
  retain their existing explicit E holds; no scheduling promotion is claimed.
- Private source mutation reintroduced fetch/fulfill only for Acceptance reads:
  both new cases failed, **12 passed / 2 failed**, with bounded settlement and no
  skipped cases. `/tmp/pi-web-test-core.xRgAVW/run.json`, snapshot
  `/tmp/pi-web-move-transport-red.oFwFzg`, log `/tmp/pi-web-move-transport-red.log`.
- Native diagnostic green warmed the old Playwright pool, held the original
  browser continuation for **6.5s**, then required actual status consumption and
  asserted **no APIRequestContext socket was allocated** by the gate. The entire
  original Activity inventory passed: **214.409s driver / 205.761s capsule**,
  **8.011s support/manifest preparation**. `/tmp/pi-web-test-browser.vJalxy/run.json`,
  source `sv9agndyci7ldsfh1snv043rk6a65ic8`, log
  `/tmp/pi-web-move-transport-native-green.log`. This deliberate contention probe
  is separate from ordinary candidate acceptance.
- Independent read-only review found no remaining blockers in ordering, real
  response/error preservation or observer/route lifecycle. Synthetic callback
  tests and diagnostic source runs are not complete candidate acceptance.

## Complete candidate acceptance

`nix run .#test -- all --workers 4 --jobs 4` passed against immutable source
`/nix/store/mmhjnj0kxdbsbn9pffvs1slv7zkdm4lj-source`, outer digest
`1b9b0a4d4777bb25eb099f89febcde753dfdc3e7769180fdc96e2fb613a79967`.
Only this plan's evidence/status text and archival path changed after that export;
application, tests, fixtures, Nix and static-check inputs remain unchanged.

- End-to-end command/log interval **376.318s (6m16s)**, including in-run realization;
  no separate prewarming was performed for this final command. Earlier focused
  and diagnostic runs had warmed shared prerequisites. Native x86_64 Linux,
  32 effective CPUs/about 47.8GiB available at admission; requested/effective
  browser/core widths **4/4**, levels overlapped. This is not a cold-cache or
  machine-exclusive timing claim.
- Core/static/plugin: **438 files / 3,393 tests / 12 suites**, no failure, skip or
  cancellation; driver **256.142s**, inner pipeline **253.845s**. Static declared
  input outputs were reused; selected effectful execution was fresh.
  `/tmp/pi-web-test-core.tWrUm0/run.json`.
- Browser/terminal: **26 groups / 59 scenario receipts**, all passed; driver
  **314.888s**, with **8.834s support/manifest preparation** inside that interval.
  `/tmp/pi-web-test-browser.sI812K/run.json`.
- Genuine Home Manager deployment: passed, driver **56.621s** including its
  realization and **19.08s VM test script**. Unit inactive, MainPID0, cgroup absent,
  TCP refused, no errors. `/tmp/pwv-yvoGJ6/run.json`.
- Selection/admission: `/tmp/pi-web-test-source-EoPWUd/selection.json`; full log
  `/tmp/pi-web-move-defaults-all-final.log`. Intervals overlap and are not additive.
- Local main remained `96802b0ac071080e96262ce1103cf367e31fb80c` throughout verification.
  Move commit is `030f42ee012421caf5c9688b28b99be6cfc71ce6`; the fixture correction
  is a separate review question. Exact final feature ID is provided by its commit
  receipt and merge proposal rather than embedded in its own commit contents.

## Completion Checklist

- [x] Remaining original-run uncertainty was explicitly disclosed; the user chose
  the bounded reproduced-hazard correction. No passing retry is labelled a fix.
- [x] Required static/core, browser/terminal and deployment acceptance passes.
- [x] Candidate/source IDs, evidence and retained resources are recorded honestly;
  no integration, cleanup or publication is claimed by this verification plan.

## Recovery

Diagnostics run only on synthetic data in Nix builders. Preserve failed evidence,
private builders and the committed move fix. Do not touch the installed service,
credentials, unrelated worktrees or remote refs. Temporary diagnostic snapshots
remain retained unless separately authorized for bounded cleanup.
