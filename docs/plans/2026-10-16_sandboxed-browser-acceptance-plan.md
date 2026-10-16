# Separate browser and deployment acceptance

## Goal

Run the unchanged complete browser/terminal scenario inventory against the Nix-built production launcher in an ordinary Nix build sandbox. Retain a small, genuine NixOS/Home Manager deployment check. Do not require nspawn, namespace-root, automatic UID allocation, experimental Nix cgroups, host configuration changes, a development server, or the installed service.

## Status

Implementation and native acceptance are complete on the isolated feature branch.
Local integration is **pending a completion decision**, not implied: when asked,
the user requested the measured improvement breakdown instead. Do not infer merge
or cleanup approval. Local `rst-main` independently advanced to the Pi SDK 1.3
upgrade at `c7b656ad6785108040356b3580325207bae11700`; composing with that target
requires separate resulting-candidate verification. The accepted run below uses
the feature's SDK 1.2 base, not that uncomposed upgrade.

## Context

The user explicitly requested this separation after discussing the daemon-wide prerequisites of nspawn. The previously created clean `feat/nspawn-acceptance` worktree is reused; no container implementation or host settings were changed. It was advanced without conflicts to local `rst-main` at `e5a4a77d7a6e61aa4d9ff7a13e74dba2cb92bed1` before source edits.

The prior complete acceptance passed in 658s with 304 core files/2,333 tests and 24 VM groups/53 scenario receipts. That is historical evidence for a different dependency/source candidate, not a timing claim for this change.

## Plan Relationship

This supersedes the environment arrangement, not the coverage or safety obligations, of the completed Nix-native and parallel-acceptance plans dated 2026-10-15 and ADRs 0023/0024. A new ADR and the maintained testing/browser guides will own the resulting contract. The existing scenario inventory, distinct input variants, success-only completion, deadlines, immutable production package and source export remain authoritative. Core scheduling optimization and dependency changes are not owned here.

## Architecture

- Core/static/plugin checks continue in the existing ordinary Nix sandbox.
- Browser acceptance uses that same ordinary sandbox boundary, pinned Chromium and production package. A process-backed adapter owns only applications it starts; it must never adopt a listener or control a host/user systemd instance. Private lane/group environments replace VM-specific service ownership only in this backend.
- The small closure-only KVM guest retains real Home Manager activation/default-target startup, ordinary-user permissions/environment, production launcher, restart/session persistence and cgroup/port shutdown evidence.
- Fresh entry points execute the same definitions as checks, using nonce-keyed execution rather than replaying cached test results. Failure diagnostics and successful acceptance remain separate outcomes.
- Resource estimates remain admission budgets, not CPU/RAM reservations. All levels use one verified immutable source export; peer failures close admission and await owned work.

## Plan

- [x] Prove the ordinary-sandbox launcher/service adapter with focused ownership, cancellation, credential isolation and detached-descendant tests; retain original failure diagnostics.
- [x] Execute unchanged `session-links` and `terminal` acceptance in the ordinary Nix sandbox with the actual package and pinned Chromium, before promoting the backend.
- [x] Run every existing browser/terminal group through bounded isolated process lanes with exact package/selection/scenario and settlement receipts; test invalid/missing evidence and failure publication.
- [x] Reduce the genuine Home Manager VM to an explicit deployment smoke, preserving activation, generated startup, permissions/environment, real restart/persistence and observed cgroup/TCP closure. Do not weaken these assertions to make a backend pass.
- [x] Wire cacheable checks, fresh CLI, complete orchestration and CI to the three levels; test selection, fresh identities, admission, failure propagation and source-input separation.
- [x] Obtain independent safety/coverage review, address findings and complete native core, full browser and deployment VM acceptance for one settled candidate. Record exact inputs, commands, timing, reuse and artifacts.
- [x] Update the owning ADR, testing/browser guides and instructions; distinguish historical VM timing from new measurements and any evidence-only follow-up checks.
- [ ] Create reviewable unsigned feature commits, resolve completion intent, and perform only separately approved exact-state local non-FF integration/cleanup. No remote publication.

## Progress and retained focused evidence

The chosen browser boundary is **one whole group per ordinary Nix build sandbox**,
not multiple service users sharing a network namespace. The process receipt covers
its registered child, pipes and original POSIX group only; Nix owns outer containment.
All original suite/scenario sources and browser deadlines remain unchanged.

- Initial focused contracts/static passed in 39.627s. Real `session-links` then
  failed in 42.424s because the ordinary builder lacked explicit sans-serif fonts.
  Its immutable diagnostic capsule and screenshot remain at
  `/nix/store/anjqz5gvc0kc3718h7rf4bvl8zv7073p-pi-web-browser-session-links-diagnostics`.
  Added pinned fonts/fontconfig, immutable alias configuration and private caching;
  no application or visibility assertion was changed to hide the failure.
- Independent source review identified report-persistence early rejection, incomplete
  namespace identity validation, a missing finalized cacheable-tree guard and
  preparation-width/tool-closure omissions. Added drain-before-propagation,
  complete prefix-bound namespace evidence, the immutable pre-read guard and
  separately resource-capped preparation including the entire tool/font closure.
- `/tmp/pi-web-sandbox-browser-fonts.2IbZyZ` retained a 41.096s failed focused run:
  two passing-evidence cases exposed an overescaped new namespace regex. Corrected
  it with explicit per-namespace patterns; rejection cases remain.
- `/tmp/pi-web-sandbox-browser-native.FfWDsG` then passed four focused core files
  and static checks in 41.713s, and genuine `session-links` in 16.426s. Terminal
  failed in 40.120s at the unchanged first readiness deadline. Creation returned
  HTTP 200 but no event-stream GET followed. A separate ordinary-sandbox real
  Chromium/HTTP probe proved `navigator.onLine=false` despite successful local HTTP;
  browser network emulation did not make this advisory flag authoritative.
- The user explicitly approved the production correction. Added whole-TSX new and
  restored-tab regressions; original component failed exactly those two while
  eleven existing cases passed, with static checks, in 43.173s
  (`/tmp/pi-web-sandbox-terminal-red.XgkvC9`). Removed only the advisory online
  precondition from `connect`, retaining closing/disposal/exit and lifecycle guards.
  No browser online flag, assertion, deadline or production timeout was falsified.
- `/tmp/pi-web-sandbox-terminal-green.AHduQO` passed five focused core files/static
  in 44.726s, unchanged native `terminal` in **111.834s including changed-package
  realization**, and `session-links` in 14.150s. These are focused command runtimes,
  not complete acceptance or a new benchmark. Source/manifest, exact commands,
  logs and result JSON remain beneath that root.
- The first deployment-driver realization failed Python type checking (six accesses
  inferred from a `None`-initialized proof dictionary), before any guest test ran:
  `/tmp/pi-web-sandbox-browser-native.FfWDsG/service.log` and
  `/tmp/pwv-pORQkv/run.json`. Corrected typing and independent review's guest-side
  artifact hashing, bounded failed-probe evidence, existing-channel early-boot
  diagnostics and isolated unsafe-helper export. The added extraction fixture
  initially omitted its `settlement` global; retained the 41.976s failed focused
  run at `/tmp/pi-web-sandbox-service-proof.t6eFof`, then completed the fixture.
- `/tmp/pi-web-sandbox-service-native.KLzc2k` (content/mode digest
  `e20f1282960acac84ecbe5637cc1508f0d335f26665bdc6da6131fb2992f6198`) passed six
  focused core files/static checks in **41.585s**, native graph evaluation in
  **4.744s**, and the real fixed deployment VM in **63.339s** (driver **19.59s**).
  `/tmp/pwv-4GPL64/run.json` and its exact guest artifacts retain genuine activation,
  environment/permissions, durable HTTP write/restart, native PTY and final
  cgroup/TCP settlement proofs, symlink probe and pre-copy guest hash verification.
  Only that run's verified owned runtime/tmp/cache bulk was removed; diagnostics
  remain. This focused proof is not complete core/browser acceptance.

- First complete trial `/tmp/pi-web-sandbox-complete.Pk30ZL` (digest
  `69b7e1848ada90cdfed302b0dac9820b83a58a4138b147f71a6681653534c04a`) failed
  after **237.314s**: 23/24 whole browser/terminal groups passed; trust's first
  decision correctly hit the active-session guard during lazy startup. The
  coordinator aborted/awaited core and did not start deployment. Retained exact
  capsule: `/nix/store/6kiwkfqg89vqdf9f8p77jvyj5kgz9848-pi-web-browser-trust-diagnostics`.
  Trace showed an early `running:false` response before wrapper registration,
  a 409 trust response, then startup persistence after that rejection. This was
  fixture readiness, not authority to weaken the production trust guard.
- Added a default-deadline readiness barrier before **each** original trust Apply:
  successful HTTP, registered `running:true` wrapper and all streaming/prompt/bash/
  compaction flags false. Preserved every scope/propagation/revocation/clear
  assertion, one click per decision and original detach deadlines; no retries or
  error suppression. Added callback contracts for absent/missing/busy/idle state
  and HTTP failure. `/tmp/pi-web-sandbox-trust-ready.gpE5CA` passed harness/static
  in **39.629s** and real trust acceptance in **17.386s**. Independent source review
  found no blocker; actual browser serialization/polling passed in that native run.

- Second complete trial `/tmp/pi-web-sandbox-complete-ready.3p7YOX` (digest
  `55fa34f5bcc218d7a39e1d79df8ef8d282aa068234783dd29b4c728b3f6c96ba`) failed
  after **197.793s** in Move: an existing enabled-control predicate dereferenced
  `null.disabled` before the newly opening Browse picker mounted. Retained capsule:
  `/nix/store/vd8ml68zivv5p2s3v95pbbdb17byympf-pi-web-browser-move-diagnostics`.
  Core was aborted/awaited and deployment was not started. This is not an unchanged
  passing retry or a new complete benchmark.
- Replaced all ten unsafe enabled-control polls in that helper with a shared
  closure-free predicate requiring a present control with `disabled === false`.
  No action, assertion, selector, held-request ordering or deadline changed. Added
  serialized-callback cases for absence, missing properties, disabled and enabled
  controls; Trust predicate contracts now also execute after serialization in a
  separate VM realm. `/tmp/pi-web-sandbox-move-ready.oAzVDL` passed harness/static
  in **43.390s** and real Move in **22.759s**. Independent review found no blocker.

- Third complete trial `/tmp/pi-web-sandbox-final.S8hpGs` (digest
  `6c3fd0d4cb255ce0efe8c48c74820a031dd0e507542937bed4e7ad139e041940`) failed
  after **244.095s**, again at the first trust decision. Exact trace proved the
  readiness response was still `running:false`: pinned Playwright accepted the
  async predicate's truthy Promise, then adopted false without another poll.
  Earlier focused success did not establish a deterministic fix. The failure
  capsule remains `/nix/store/46bbfyq9p1f0j98c50n22m3yigdf1rz9-pi-web-browser-trust-diagnostics`.
- Replaced that broken poll with one non-prompt `get_state` command per Apply,
  joining normal construction/extension binding. Require HTTP/application success,
  the selected session ID and all four idle flags; timeout stays **30 seconds**,
  with zero retries. `/tmp/pi-web-sandbox-trust-ack.3ZlPfC` passed real trust
  acceptance in **18.427s**. No production trust guard/API was changed.
- Audited the same framework assumption: ten pre-existing async predicates in
  Git Workflow, Appearance, Session Launch and Activity now use a shared awaited
  `page.evaluate` poller. One monotonic 30-second budget includes every read/delay;
  only resolved falsy values poll again, original errors propagate, and late
  evaluations remain observed until harness/context cleanup. Fixed Session Launch's
  separate wrong-envelope idle predicate to require a live wrapper's actual
  `state` flags. Predicate/action coverage and deadlines were not reduced.
  `/tmp/pi-web-sandbox-async-focused.igcPzX` passed three focused files/static in
  **40.140s**, including deterministic false-Promise, deadline, late-result/error,
  strict acknowledgement and serialized response-shape contracts.
- A separate full core run from `/tmp/pi-web-sandbox-core-full.kXsmGS` passed
  **306 files / 2,382 tests / 10 suites** in **357.785s**. This precedes the final
  async-waiter/acknowledgement delta and is not relabelled as final-candidate or
  complete combined acceptance.

The new three-level CLI, cacheable checks, CI split and maintained guides are
implemented. Independent ownership/evidence and final readiness reviews found no
remaining blocker. Complete native acceptance passed as follows.

## Complete acceptance evidence

- **Tested implementation:** `2b863662a78d322419257387252b1595f026a2a7`.
- **Frozen input:** `/tmp/pi-web-sandbox-awaited.nIeIy5/source`, content/mode SHA256
  `74d3ee5159405ec7ea59efab577f21030828d8d48287bea80447a5903ea64425`.
  Export and matching-manifest verification passed; post-run verification confirmed
  the live feature source still matched those tested bytes/modes before this
  evidence-only documentation update.
- **Command**, executed with the physical cwd inside that frozen export:

  ```sh
  nix run --no-write-lock-file --max-jobs 2 --cores 4 \
    path:/tmp/pi-web-sandbox-awaited.nIeIy5/source#test \
    -- all --workers 4 --jobs 4
  ```

- **Result:** exit 0, **403.590s (6m44s)**. `results.json`, `complete.json`,
  `complete.log`, `source.json`, `post-run-verify.log` and `metrics.json` remain
  under `/tmp/pi-web-sandbox-awaited.nIeIy5`.
- **Core:** `/tmp/pi-web-test-core.Y38qlO/run.json`; **399.373s** report interval,
  **307/307 files, 2,393/2,393 tests, 10 suites**, no failures/skips/cancellations,
  unstarted files, surviving observations or settlement uncertainty. Exact output:
  `/nix/store/apyn3x93pbc7ndidd795rbka8mx5v2pa-pi-web-core-checks`, with
  `artifacts/run-CYW9kn/{summary,inventory}.json`.
- **Browser/terminal:** `/tmp/pi-web-test-browser.Dtm3FQ/run.json`, **218.250s**;
  all **24 groups / 53 exact success-only scenario receipts** verified against
  the plan. Each immutable group output retains its harness, coverage, logs and
  Chromium traces. Group work summed **747.350s**; queue work was
  **194.912/175.207/194.742/182.489s**. No assertion, viewport/locale/preference
  variant or deadline was removed to obtain this result.
- **Deployment:** `/tmp/pwv-Sqlr1r/run.json`, **22.357s** report interval;
  driver script **17.43s**, receipt interval **17.336s**. All five mandatory proofs,
  actual service/cgroup/TCP settlement, host-only symlink probe, safe collection,
  guest-before-copy hashes and independent host comparison passed. Only the exact
  verified owned runtime/tmp/cache bulk was removed; manifests/JUnit/journals,
  observations, fixture archive and helper diagnostics remain.
- **Graph:** `nix flake check --no-build --no-write-lock-file -L
  path:/tmp/pi-web-sandbox-awaited.nIeIy5/source`, exit 0 in **4.279s**;
  `graph.log`/`graph-result.json` retained. Other systems were not executed.
- **Package:** `/nix/store/nhbj7a43blj3j3z81cwvrbhzckynzhh7-pi-web-0.9.3`,
  derivation `/nix/store/c6f70ssipiscnn4b6ffxm0ywrmj38yw8-pi-web-0.9.3.drv`.
  The application derivation matches the focused terminal proof; intervening
  harness/tests/docs did not rebuild application inputs. Pinned runtime:
  Node 22.23.3, Chromium 155.0.8059.79, Next 16.4.2, Pi SDK 1.2.0.

Phase intervals come from retained run-report timestamps; 403.590s is the actual
outer command timer. Browser precedes deployment while core overlaps both, so
adding all three phase intervals would double-count work. The earlier 658s full
run becomes **403.590s: 1.63x faster, 38.66% less wall time**. The recorded
52m11s original baseline is about **7.76x** this runtime, across both migrations.
Dependency/source maintenance differs between historical candidates; this is
observed timing, not a single-variable A/B claim.

Host: native x86_64 Linux, **32 logical CPUs**, about **51 GiB available memory**
at browser admission. Core requested/effective workers **4**; browser sandboxes
**4**. Combined admission estimated **16 CPUs/27 GiB**, including realization
peaks, not a reservation/hard partition. Deployment used **1 vCPU/1536 MiB RAM/
2 GiB sparse state disk**, a verified initial profile rather than a proven minimum.
Prerequisites/package/driver were warm while core, every browser capsule and the
guest executed freshly. Earlier package realization, model work, review, waiting
and coordination are outside the command timer.

Core is now the critical path. Exclusive files summed **322.286s**, led by
`cleanup.test.mjs` **79.762s**, `discard.test.mjs` **40.420s**, `server.test.mjs`
**29.446s** and `project-management.test.mjs` **23.389s** in Git Workflow. No
core isolation classification was relaxed; further audit is separate scope.
Native ARM, GitHub execution and cold-cache timing remain unverified. Host daemon
features/configuration, installed service, remote publication and historical
failure roots remain untouched. A final evidence-only update changes this plan
and the testing guide; its proportional checks are reported separately, not
relabeled as another full run or an SDK 1.3 acceptance result.
No host Nix configuration, privilege, installed service or remote operation changed.

## Risks and Recovery

Chromium, PTYs and process/descendant settlement must work without elevated sandbox privileges. A failed feasibility proof blocks promotion; it is not authority for host sudo, experimental daemon changes, deadline inflation or an unsandboxed fallback. Keep production source changes outside scope unless separately approved. Preserve current-run failures and all historical diagnostics; cleanup requires exact ownership, settled processes and complete evidence.

## Completion Checklist

- [x] All 52 browser scenario/input IDs plus the terminal receipt remain covered with unchanged substantive assertions and deadlines.
- [x] Browser execution uses the installed production artifact in an ordinary Nix sandbox without host credentials, user bus, installed service or development build.
- [x] Genuine deployment proofs pass independently in the small restricted-network, closure-only KVM guest.
- [x] Complete native acceptance and independent review pass; exact candidate, command runtimes and retained artifacts are recorded without relabelling old evidence.
- [x] Maintained guides/ADR describe the new boundaries and feature history is reviewable; unapproved integration/cleanup and remaining verification gaps are explicit.
