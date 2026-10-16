# Evaluate remaining dependency exposure and toolchain choices

## Goal

Trace actual vulnerable-input reachability for the remaining sprintf-js and braces
advisories, then evaluate Node 24 LTS and a TypeScript 6 compatibility trial. The
user authorized this sequence on 2026-10-16. Evaluation is not a claim of exploitability
or authority to silently replace retained libraries, force peers or activate a host.

## Context and Plan Relationship

Branch `chore/dependency-risk-evaluation`, linked worktree
`/home/robert/projects/3rdparty/pi-web-worktrees/dependency-risk-evaluation`, based on
local `rst-main` at `c7b656ad6785108040356b3580325207bae11700`.

The compatible dependency and SDK 1.3 passes are archived. This plan owns their
remaining advisory-reachability and runtime/compiler evaluation, not the completed
Nix acceptance architecture or unrelated feature plans. `docs/dependencies.md`
owns durable advisory, compatibility and intentional-pin dispositions. The global
Git workflow owns completion intent, exact-candidate integration and cleanup.

## Non-Goals

No live credentials, provider/login calls or user sessions; no host-service contact,
activation/restart, remote Git action or publication. No DoS/stress payload, blanket
audit suppression, forced peer resolution, weakened security assertion, enlarged
application deadline or speculative dependency replacement. Retain SDK 1.3, native
PTY, proper-lockfile and KaTeX choices unless concrete evidence requires a separately
bounded decision. Production builds are allowed only in isolated Nix test builders.

## Plan

- [x] Trace sprintf-js advisory conditions through the exact installed Mammoth,
  argparse and preview route; distinguish module loading, executed calls and
  attacker control; retain source/call-chain evidence and bounded experiments.
- [x] Trace braces advisory conditions through actual root/demo lint callers,
  configuration/pattern provenance and all installed reverse paths; record runtime
  versus tooling scope without assuming dev dependencies are absent from Nix.
- [x] Evaluate pinned-channel Node 24 availability, lifecycle/engine/native-module
  compatibility and migration surface; run an explicitly labelled isolated trial.
- [x] Evaluate an available supported TypeScript 6 release, Next/parser/tooling
  compatibility and root/demo diagnostics in a separate labelled trial; do not
  infer success/failure from peer declarations alone.
- [x] Record scoped findings and any warranted regression coverage in maintained
  guides, with independent review; present material adoption/remediation choices
  before turning an evaluation into a retained major migration.
- [x] Verify any resulting candidate according to `docs/testing.md`; distinguish
  experimental trials, focused checks and complete accepted-source evidence.
- [ ] Commit reviewable work and hand off to the user-controlled Git completion
  workflow, archiving only after all evaluation obligations have dispositions.

## Completion Checklist

- [x] Both advisories have exact version/input/call-path evidence and explicit
  confidence limits, with no unsupported security-clean claim.
- [x] Node 24 and TypeScript 6 have measured compatibility results or a concrete
  blocker; retained changes, if any, match explicit user decisions.
- [x] Tests, review, original failures, commands, runtimes and source identities
  are retained and honestly scoped; no unrelated pins or state were altered.
- [ ] Durable facts and remaining work have maintained owners; Git state and
  integration/cleanup authority are reported accurately.

## Decisions and evidence

The user explicitly selected **Adopt Node24 LTS** and **Adopt TypeScript6** in
separate questions after the isolated trials. Retained implementation now selects
Node **24.21.0**, root/demo typings **24.19.2**, compiler **6.0.3** and
undici-types **7.24.6**. The launcher/package/demo minimum is **24.0.0**, while
core still refuses any major other than **24**. Demo CI follows 24.21.0; no CI
publication was executed. SDK, PTY, proper-lockfile, KaTeX and flake.lock stay fixed.

### Advisory findings

- Sprintf review `/tmp/pi-web-sprintf-reachability.cx3xSy/report.md` confirms
  Mammoth1.13.0 → nested argparse1.0.10 → sprintf-js1.0.3. The vulnerable condition
  requires a format string controlling numeric precision. The conversion-library
  graph excludes its CLI parser/formatter branch; hostile document/style-map data
  does not become those format parameters in the reviewed path.
- Braces review `/tmp/braces-advisory.iGyDEd/report.md` confirms the Next lint chain
  and the sole `settings.next.rootDir` gate. Neither tracked config supplies it;
  cwd/file names/hrefs are not automatically reinterpreted as brace patterns.
- Bounded child probes `/tmp/pi-web-advisory-sentinels.tybwoxrk` converted two
  tiny DOCX inputs including an applied embedded style map, observed no forbidden
  module loads, and positively intercepted both forbidden branches. The Next helper
  returned curly-braced cwd literally, with string/array positive controls for its
  stubbed glob export. No real formatter/glob parser or advisory payload executed.
- An initial private probe's reporting-only package-version lookup used the wrong
  relative path, after its conversion/control assertions had succeeded. Original
  failure JSON is retained; the metadata lookup was corrected before the successful
  probes. Its Nix-shell-owned temporary directory was not claimed as durable evidence.
- Persistent `lib/dependency-advisory-boundary.test.mjs` and child fixture preserve
  these bounded controls without production patches. New file remains in the
  runner's safe exclusive fallback; it is not excluded or given relaxed assertions.
- Fresh public matching on the adopted candidate: root **803 names /2 records**
  (braces, sprintf-js), demo **660 names /1 record** (braces). Affected packages
  remain tracked, not patched or audit-clean. Source/config-specific findings and
  limits are maintained in `docs/dependencies.md`.

### Compatibility measurements and review

- Node-only public-source trial `/tmp/pi-web-node24-evaluation.s2ohvtzo`: all
  runtime bindings and the strict-major guard changed to24, while compiler/types
  remained5/22. Static checks and **28 selected tests** passed in **133.414 s**,
  including native module realization. Not full acceptance.
- Independent compiler-only trial `/tmp/pi-web-typescript6-evaluation.obbhowaw`:
  Node22/types22 retained; normal lock update changes only TypeScript and root
  metadata. Static checks and **8 lint probes** passed in **80.701 s**. Separate
  demo install/preparation/typegen/typecheck/lint and **10 regressions** passed in
  **30 s**, with its existing unused-locale warning. No compiler/lint config edits.
- Actual adopted combined candidate: **37 focused tests /4 files** plus static
  checks passed in **97 s** after matching native dependencies were realized.
  Two new fixture unused-parameter warnings were then removed without suppression
  or behavioral change; complete acceptance below must cover that final edit.
- Final combined demo fixture `/tmp/pi-web-node24-typescript6-demo.lvv9z463`:
  264 tracked public inputs plus a verified root export; normal script-enabled
  engine-strict install, preparation, typegen/typecheck/lint and **10 regressions**
  passed in **29 s**. Existing unused-locale and module-type warnings remain.
- Nix npm cache `sha256-c9Q5G8FJ415i2qaDj/Pa+HjuZOrnaqkNVkIVcuUXf+4=`;
  intentional hash-discovery failure took **20 s**, not acceptance. Each root/demo
  lock changes only three development packages plus root metadata/engine floor;
  no runtime dependency records change. Nix input revisions are byte-identical.
- Independent final safety review `/tmp/pi-web-dependency-safety-review.6Sbv3f/report.md`
  found no concrete blocker, confirmed runtime/guard/floor/graph alignment and
  bounded child-only sentinels. It executed no tests or repository writes; its
  parent-pending final demo item is resolved by the separate29s run above.

`test-results/dependency-risk-evaluation/` retains original failures, reports,
public advisory/metadata, source identities, graph deltas and command receipts.
Full accepted-source evidence is recorded below; Git completion handoff remains
owned by the separate user-controlled workflow.

## Complete acceptance

`nix run --no-write-lock-file .#test -- all --jobs 2` passed in one invocation,
**681.283 s command wall time**, excluding earlier realization/trials, research,
focused checks, demo maintenance, model work and coordination. No application
deadlines were changed and no full-run failure/retry occurred.

- Verified source content/mode SHA256:
  `70adae1d3871cc0ddffa5f5af61279e57217a55fb570ac76bd45c75338a7ed45`.
  All **971 accepted root files** and **264 demo inputs** were compared afterward
  and matched before these status-only plan updates.
- Complete core/static/plugin: **305 files /2,335 tests**, zero failures/skips;
  exporter contracts, real type generation, TypeScript and lint passed. Core
  realization/execution ran 13:16:36.072–13:24:08.944 UTC, overlapping the VM.
- Full packaged-service VM: **24 groups /53 scenarios**, four lanes, all passed;
  acceptance **544.458 s**. Activation, used-lane restart/persistence, evidence
  collection and runner/application settlement succeeded on every lane.
- Core, VM realization and driver report settled, zero observed survivors and no
  uncertainty within bounded owned-observation scope. Successful runners removed
  only their own settled bulk; manifests/diagnostics remain. This is not a universal
  escaped-process proof, machine-wide reservation or live-provider security audit.
- Nix-built package:
  `/nix/store/kj5qqvx18fm7q4svvh60vayyarml4lyi-pi-web-0.9.3/lib/node_modules/@agegr/pi-web`.
- Retained roots: source `/tmp/pi-web-test-source-sOOev3`, core
  `/tmp/pi-web-test-core.Fv5boj`, VM `/tmp/pwv-6EfM7W`. Source manifest, full report,
  core/VM receipts, logs, scenario inventories and review reports are copied under
  `test-results/dependency-risk-evaluation/`. Earlier private probe reporting error,
  expected cache-hash failures and focused-run lint warnings remain separate.

Current runtime/compiler/advisory facts belong in `docs/dependencies.md`,
`docs/testing.md` and README/demo guidance. Only status/evidence updates and
archival to this plan follow the accepted app/test/dependency/Nix inputs; they
receive identity/documentation checks, not relabelled full application runs.
No host service, real credentials/sessions, remote Git, publication or deployment
was touched. Pending local integration and resource cleanup require their own
Git workflow decisions and exact-action gates.
