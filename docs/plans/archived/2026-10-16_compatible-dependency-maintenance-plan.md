# Compatible dependency maintenance pass

## Goal

Finish one coherent compatible dependency refresh, verify the settled candidate,
and report remaining advisories, compatibility blockers and deliberate holds.
The user's 2026-10-16 “let's go” authorizes implementation, not publication,
installed-service changes, local integration or cleanup without their own gates.

## Context

- Isolated branch: `chore/dependency-maintenance-pass`.
- Worktree: `/home/robert/projects/3rdparty/pi-web-worktrees/dependency-maintenance-pass`.
- Starting local `rst-main`: `3b7ab9d43a6de1c7f028452045ca4a215a9a5b7c`.
- Root/demo have independent locks. ESLint 10.12.0 was already integrated with
  documented Next plugin peer exceptions and real-config regression tests.
- Previous dependency refresh is archived; this plan owns only the new pass.
  `docs/dependencies.md` remains the durable exception/advisory owner.
- Current acceptance is the sandboxed Nix core/static/plugin check plus full
  packaged-service NixOS VM check, not older development-server procedures.

## Scope and safeguards

Refresh compatible stable direct/transitive npm dependencies together, including
coordinated Next and lint-preset patches. Preserve exact Pi SDK/native PTY pins,
proper-lockfile 4.1.2, KaTeX's tested override, Node 22 and the deferred compiler
major unless new evidence requires a separately reviewed decision. Inventory Nix
input currency; do not change toolchain policy or bump inputs merely to change
version numbers. Keep npm's ordinary resolver and the established tested peer
exceptions; no force/legacy-peer-deps flags, new blanket overrides, disabled rules,
weakened assertions, longer application deadlines or live credential use.

One parent writer owns manifests, locks, Nix hashes, source changes and Git.
Independent researchers may inspect release notes/toolchain metadata; acceptance
is coordinated after review and source export settles. Production application
builds are allowed only inside isolated Nix verification builders, never in a
checkout or against the installed service. No Git remote operations.

## Plan

- [x] Create isolated worktree from current local target, initialize CodeGraph,
  and read current dependency/verification contracts.
- [x] Inventory resolved root/demo versions and current public registry metadata;
  identify compatible updates, explicit holds and coordinated package groups.
- [x] Review material release changes; update manifests/locks using the update
  shell and ordinary npm resolver, preserving the listed contracts.
- [x] Update the Nix npm cache; review resolved graph, integrity/engine/peer and
  license changes. Repair only demonstrated compatibility defects.
- [x] Independently review the stable change set before full acceptance.
- [x] Complete Nix core/static/plugin and full packaged-service VM acceptance;
  separately validate changed demo dependencies without a production demo build.
- [x] Recheck final currency/advisory matches and maintain the remaining-issues
  report in `docs/dependencies.md`, distinguishing matches from exploitability.
- [x] Commit reviewable changes and hand off the verified feature to the separate
  global Git completion/integration workflow. That workflow owns the unresolved
  completion choice, exact-action integration approval and cleanup approval.

## Completion Checklist

- [x] Updated versions, unchanged pins, remaining constraints and advisory scope
  are explicitly recorded; no unsupported audit-clean claim.
- [x] Complete acceptance passes on the settled candidate; exact inputs, commands,
  selections, outcomes, wall times and retained artifact paths are recorded.
- [x] Demo maintenance evidence and independent review have clear dispositions.
- [x] Git result, integration state, no-remote/no-deployment boundary and retained
  or approved-cleaned feature resources are reported.

## Evidence

Inventory: `/tmp/pi-web-compatible-pass.SgyrZK`, 2026-10-16, 807 resolved names,
zero registry errors. Root has 130 instance version changes; demo 34, including
hoisting changes rather than assuming every path delta is a new package family.
Final advisory matching remains braces (both) and sprintf-js (root); no audit-clean
claim. Exact current versions/holds are maintained in `docs/dependencies.md`.

Independent reviews: Next `/tmp/pi-web-next-compat.doD6vfJC/FINDINGS.md`;
runtime/test patches `/tmp/pi-web-compatible-review.T1djVT/REPORT.md`;
Nix/Home Manager `/tmp/pi-web-nix-currency.qbUFL4/REPORT.md` and
`hm-followup/REPORT.md`; graph/integrity/license review
`/tmp/pi-web-compatible-pass.SgyrZK/dependency-batch-review.md`. No material blocker
identified. Nix updates are on existing tracks; Chromium security fixes supply
additional benefit, Node 22 and VM home state version remain unchanged.

Npm cache: `sha256-r9FWZIBzE7Ik6WS8wNO0zp4wkeBxO7boDqTZ7whTNf8=`.
The expected placeholder-hash failure is preserved in
`test-results/dependency-maintenance/cache-hash-discovery.log` (18s); it did not
execute application tests and is not an application failure or acceptance pass.

### Complete acceptance

`nix run --no-write-lock-file .#test -- all --jobs 2` passed in one invocation,
**695.765 s command wall time** (11m35.765s), excluding research/model work and
subsequent evidence inspection. It used one verified source snapshot:
`d52590dc46b16e369633f8aa22fb3b436ff57396be90b62aef3fdeb77ca353e6`.

- Core/static/plugin: **304 files / 2,333 tests**, zero failures/skips;
  exporter contracts, Next type generation, TypeScript and lint passed.
- Full packaged-service VM: **24/24 groups and 53/53 scenarios**, four lanes;
  every lane's activation, restart/persistence, collection and runner/application
  settlement passed. No observed survivors or uncertainty within bounded scope.
- Admission chose overlap with core jobs 2 and VM 8 CPUs/16 GiB. This is not a
  machine-wide resource reservation or universal escaped-process certification.
- Core including realization: **457.935 s**; sandbox lifecycle **415.685 s**.
  VM including realization: **691.051 s**; VM acceptance **515.803 s**. These
  overlap and must not be summed. No deadline changes, fixes or retries.
- Package: `/nix/store/gwqwmf7rhmyw3sn58zc4czaknpfrgbf9-pi-web-0.9.3/lib/node_modules/@agegr/pi-web`.
- Retained source `/tmp/pi-web-test-source-dNPi2G`; core
  `/tmp/pi-web-test-core.4pYeH2`; VM `/tmp/pwv-D0Bmva`. Settled runner-owned bulk
  was removed by the runners; manifests/diagnostics remain.
- Logs and detailed receipts: `test-results/dependency-maintenance/` including
  `full-acceptance.log`, `full-acceptance-command.receipt` and
  `full-acceptance-report.json`. Nonfatal dirty-tree, ignored SQLite-busy and
  known npm peer warnings are retained, not suppressed.

Separate demo maintenance used the pinned Nix update shell and disposable public
source `/tmp/pi-web-compatible-demo.vi9x8y4i`, not an application-acceptance fallback:
normal `npm ci --engine-strict`, unmodified asset preparation, typegen, typecheck,
lint, **2 search tests and 8 real-config lint tests** passed in **31 s** outer
command wall time. Existing `_locale` unused warning remains. No demo production
build. The 967 accepted root files and 264 demo source inputs were hash-compared
before these status-only plan updates; all matched.

Durable version choices, advisories and license/compatibility notes are maintained
in `docs/dependencies.md`. Evidence/status-only updates and archival receive
input-identity/documentation checks, not relabelled application runs. Integration
and feature cleanup remain separate user-controlled Git operations.

### Git handoff

Implementation commit: `4cdf93499df288d2c70e2b7ea38460aa7ecc47d9`, on
`chore/dependency-maintenance-pass` in the isolated worktree above. Accepted
application, test, dependency and Nix inputs are unchanged; only this status-only
plan update/archival follows. As of this handoff, the feature is **unintegrated**
and the branch/worktree are retained. The global Git completion workflow is the
explicit owner of the pending user choice and any subsequent rebase, exact-candidate
verification, unsigned non-fast-forward merge into local `rst-main`, and separate
feature-resource cleanup. No Git remote action, publication, installed-service
restart or host activation occurred. This completed implementation plan does not
grant any of those operations authority.
