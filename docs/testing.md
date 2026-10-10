# Testing Pi Web

## Developer commands

From the physical Linux working-tree root, including untracked test helpers:

```sh
nix develop .#test -c node nix/test-offline.mjs
# Focused work (repeat --file for multiple exact paths):
nix develop .#test -c node nix/test-offline.mjs --file lib/worktree.test.mjs
# Smaller worker budget for concurrent reviewers, inventory, help:
nix develop .#test -c node nix/test-offline.mjs --jobs 2
nix develop .#test -c node nix/test-offline.mjs --inventory-only
nix develop .#test -c node nix/test-offline.mjs --help
# Preserve regenerable bulk for dependency/generated-file debugging:
nix develop .#test -c node nix/test-offline.mjs --keep-workspace
```

Use focused checks while fixing defects, then a full run at a stable checkpoint
once edits and review changes settle. One owner coordinates dependency preparation
and validation budgets. Pause source writers during snapshot export; after export,
the run uses its own source, not subsequent edits. Simultaneous reviewers may run
from the same worktree: each invocation owns its snapshot and mutable state.
Record the source digest, not merely a branch name, when comparing results.
A selected-file pass is not full-suite acceptance. Focused offline runs still
perform the complete static preparation: there is no tests-only mode yet. Bundled-plugin Git integration tests remain separate; the
[Git plugin guide](git-workflow-plugin.md#verification) owns their commands and
CI selection. The [removal checklist](plans/2026-09-29_policy-driven-git-tools-plan.md)
retains historical removal results.

### One baseline, not two

A **complete successful Linux offline pipeline** satisfies the common core-test,
type-generation, typecheck and lint requirements. Do not additionally run the
ordinary npm baseline just to satisfy its spelling. The alternative for prepared
non-Nix checkouts is:

```sh
node_modules/.bin/next typegen
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Unlike the offline pipeline, this alternative writes generated types into the
checkout: do not overlap it with a dev server using that checkout. Dependency
preparation is a separate prerequisite, not an application production build.

### Change-dependent acceptance

| Changed area | Required evidence beyond focused iteration |
| --- | --- |
| Application/core behavior | Complete common baseline on the stable candidate |
| Browser flow | Affected flow through `npm run test:e2e`; choose documented focused switches during iteration, broaden for shared UI/runtime changes |
| Activity review/navigation | Include `E2E_ACTIVITY_ONLY=1`; the default browser run has only partial Activity coverage |
| Optional Git plugin | Separate integration command and plugin-focused browser selection in the [plugin guide](git-workflow-plugin.md#verification); core discovery does not include `plugins/**/*.test.mjs` |
| Session Launch plugin | Separate real SDK tool acceptance and `E2E_SESSION_LAUNCH_ONLY=1` browser selection in [Session Launch](session-launch.md#verification); broaden browser coverage for shared cards/runtime changes |
| Terminal integration or shared browser/terminal harness | `npm run test:terminal`; shared harness changes also need general and plugin-focused browser acceptance |
| Documentation only | Review commands, links and preserved contracts; check any changed executable instructions. Do not rerun unaffected application suites solely for an evidence/status commit |

Record the tested candidate/input scope, command and selection, result, and exact
artifact path. After rebasing or changing relevant source, lockfile, environment
or test configuration, reassess and verify the resulting candidate. Older evidence
is not a new-tip run. A new commit ID alone does not require repeating unaffected
application checks; keep a genuine appropriately scoped exact-candidate check.
Configured Git checks still apply—this equivalence is not permission to bypass
them. Verification never grants integration or cleanup authority.

Plain npm testing does not provide the isolated runner's private environment or
bounded scheduling. **Do not use `npm test -- --test-concurrency=1`:** that option
follows the script's globs and is not a Node concurrency option. For a serial
focused Node run, put options before filenames, for example
`node --experimental-strip-types --test --test-concurrency=1 lib/example.test.mjs`.
Never run `next build` or `npm run build` during development.

## What the Linux command does

Supported systems: x86_64-linux and aarch64-linux. The Git-filtered shell keeps
its manifest-only dependency definition in tracked `flake.nix`; the launcher
reads the current working filesystem after shell entry. It exports an explicit
source/name allowlist, including untracked source helpers, while excluding Git,
dependencies, `.next` and reviewed private/ignored paths. `plugins/` source is
included for static checks, without adding its integration tests to core discovery. Symlinks/special files
refuse. This is not a secret-content detector: review files admitted to source
paths and never pass the populated checkout to `path:.`.

The original export must succeed, followed by matching manifest verification,
before Nix ingestion. The launcher handles both; no staging, manual manifest
ceremony or new npm alias is required. Package manifests are intentionally
unchanged to preserve the exact dependency derivation expected by the existing
`node_modules` marker. Never delete/move dependencies or rewrite that marker
automatically to bypass a shell refusal.

The launcher scrubs HOME, all XDG/agent/TMP directories, Nix configuration,
credentials, proxies and Node options. Its inner Nix invocation is local/offline,
with builders, substitution and registries disabled. Missing cached prerequisites
fail without remote fallback. `nix develop --offline --no-write-lock-file .#test -c …`
also makes shell entry local-only; first-time dependency preparation is separate.
No global installation, live settings or installed-service contact is involved.

The `test` shell supplies pinned tools and immutable Nix dependencies without
creating or modifying checkout-local `node_modules`. The default development
shell still prepares a writable worktree-local copy for manual development.
Identical manifests/toolchain/platform reuse the same dependency output.

Normal core execution copies filtered source into a private workspace and links
`node_modules` directly to the read-only Nix output. Source is made writable before
attaching that link; store permissions are never changed. It runs exporter
contracts, genuine `next typegen`,
`tsc --noEmit --incremental false`, lint, then the tests. Generated types never
pollute the checkout. Help runs export/verification but no test pipeline;
inventory-only discovers tests without static checks or test execution.

## Parallelism and coverage

The universe is recursive `*.test.mjs` under **app, components, hooks, lib and
public**; browser scripts and `.fixture.mjs` helpers are not silently added.
All discovered files are included. Unreviewed files warn and run exclusively.

- Default desired file workers: **8**; `--jobs` accepts canonical integers **1..32**.
  Effective workers are clamped by CPU affinity/quota, supplied Nix allocation
  and memory (1 GiB reserve plus 2 GiB per worker). This is an admission estimate,
  not a host reservation or an OS-process limit. More jobs can increase contention.
- Each file runs with private HOME/XDG/agent/TMP, constructed environment, pinned
  native Git configuration isolation and Node concurrency 1. Node options precede
  the filename. Cases sharing process-global state stay sequential within a file.
- Reviewed F/N files share the bounded pool. Latency-sensitive E files drain it
  and run alone. SDK/native deadlines and safety assertions remain unchanged.
- Failure stops new dispatch while started jobs settle. The summary reports
  assertion failures, runner errors, interrupted work and unstarted coverage.
  There is no automatic retry, deadline inflation or failure-to-skip conversion.

Nix `max-jobs` limits derivations, not inner Node workers. A check honors its actual
positive `NIX_BUILD_CORES` allocation. The fresh app honors that cap when supplied
but does not invent one; `nix run --cores` alone is not an app runtime allocation.
Concurrent invocations have independent writable state, but these limits and
exclusive lanes are per runner, not machine-wide reservations. Coordinate worker
budgets when running several reviewers (for example, `--jobs 2` per core run).
Do not oversubscribe browser/SDK-sensitive acceptance or inflate deadlines to mask
contention. Keep normal full acceptance separate from deliberate concurrency tests.
Record actual command wall time separately from shell/dependency preparation,
agent reasoning, review, approval and idle coordination time. File/case duration
sums and interrupted runs are not comparable full-suite wall-time benchmarks.

## Diagnostics and retention

Preparation phase markers and file start/end lines identify where execution
failed. `summary.json`, `inventory.json`, `events.jsonl` and per-file TAP/stderr
are retained under the printed artifact path. Assertion passes do not make a file
successful when process settlement is uncertain. A complete passing suite needs
all planned files to finish successfully; zero observed survivors is not a
certificate when observation failed.

Failures print bounded original TAP/stderr and runner reasons, including process
scan errors, without exporting private HOME/agent contents. In Nix checks these
are available through `--print-build-logs` or `nix log <exact-derivation>`; tee
success cannot mask pipeline failure. Failed builder trees retained with
`--keep-failed` may be private to nixbld: do not widen permissions to inspect them.

Record the printed artifact and fixture/export roots and their disposition in the
handoff; report storage pressure rather than making space by deleting unknown
resources. Browser/terminal run manifests also name their separate fixture roots.
`lifecycle.json` records execution, dependency identity, settlement and cleanup;
`execution.log` retains core preparation/runner output. After observed settlement,
the run owner removes only its own `source/node_modules`, `source/.next` and
`tmp/node-compile-cache`, on success **or failure**. Store links are unlinked, never
followed. Root/source identity changes, mountpoints, observation failures and
interruption prevent cleanup. `--keep-workspace` retains these regenerables too.
A cleanup error is reported as refused/possibly partial, not silently successful.

Source snapshots, manifests, reports and failed fixture state remain for diagnosis;
this is intentionally not a zero-artifact policy. Launcher exports may also be
subject to their enclosing temporary-directory owner's lifetime policy. No old
root is discovered or swept. Existing failed/interrupted/uncertain resources need
separately authorized cleanup; Nix GC does not clean ordinary `/tmp` copies or
failed build trees. Do not use wildcard or age-based reapers. Settlement covers observed original Linux process identities and a final
session scan, not arbitrary unobserved escaped descendants; fixtures must settle
their own detached helpers.

## Cached checks and separate acceptance

`checks.<system>.offline` is the argument-free cacheable pipeline;
`apps.<system>.test-offline` is the fresh app used by the launcher. Use only these
named test outputs, never the production/default package or app. Advanced direct
Nix invocation must first run `nix/export-test-source.py` and its matching
`--verify-manifest` successfully into new sibling paths beneath an owned private
0700 directory outside the checkout, then use only that exported `path:` input.
The normal developer command already does this.

Cached checks are declared-input evidence, not fresh browser/runtime acceptance.
`nix flake check --no-build` is evaluation only. Browser/terminal coverage is separate:

```sh
nix develop .#test -c npm run test:e2e
nix develop .#test -c npm run test:terminal
```

Use disposable fixture storage; see [e2e/README.md](../e2e/README.md). These scripts
launch only their own dev server on a free port, never the installed port 30141.
Linux launchers snapshot the checkout before starting the suite; each snapshot
has its own `.next`, dependency copy and server. They can run concurrently from
the same worktree without touching its manual dev server. Browser dependency
copies remain necessary for Turbopack and are cleaned under the same settled-run
policy; details and non-Linux legacy execution are in the browser guide.
Removed Workflow E2E/containment tests are not acceptance requirements. Checks
grant no integration, publication, deployment or cleanup authority over existing
resources outside their explicitly owned regenerable bulk.

References: [Node test execution](https://nodejs.org/docs/latest-v22.x/api/test.html#test-runner-execution-model),
[Nix cores/jobs](https://nix.dev/manual/nix/stable/advanced-topics/cores-vs-jobs),
[Next typegen](https://nextjs.org/docs/app/api-reference/cli/next#next-typegen-options).
