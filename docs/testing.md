# Testing Pi Web

## Developer commands

From the physical Linux working-tree root, including untracked test helpers:

```sh
nix develop -c node nix/test-offline.mjs
# Focused work (repeat --file for multiple exact paths):
nix develop -c node nix/test-offline.mjs --file lib/worktree.test.mjs
# Desired concurrency, inventory, help:
nix develop -c node nix/test-offline.mjs --jobs 16
nix develop -c node nix/test-offline.mjs --inventory-only
nix develop -c node nix/test-offline.mjs --help
```

Use focused checks while fixing defects, then a full run at a stable checkpoint.
Source writers must pause during export. A selected-file pass is not full-suite
acceptance. Bundled-plugin Git integration tests remain separate; the
[Git plugin guide](git-workflow-plugin.md#verification) owns their commands and
CI selection. The [removal checklist](plans/2026-09-29_policy-driven-git-tools-plan.md)
retains historical removal results.

The ordinary contributor baseline remains:

```sh
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

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
fail without remote fallback. `nix develop --offline --no-write-lock-file -c …`
also makes shell entry local-only; first-time dependency preparation is separate.
No global installation, live settings or installed-service contact is involved.

Normal execution copies source/dependencies into a private disposable workspace
and runs exporter contracts, genuine `next typegen`,
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
Do not overlap SDK-sensitive acceptance with other heavy validation.

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

Launcher exports and fresh-app bulk roots are retained on success as well as
failure (the enclosing temporary-directory owner may have a lifetime policy).
Successful per-file workspace removal does not remove that bulk root. Existing
failed/interrupted/uncertain resources require separately authorized cleanup;
store GC is not failed-build-tree cleanup. Do not use wildcard or age-based
reapers. Settlement covers observed original Linux process identities and a final
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
nix develop -c npm run test:e2e
nix develop -c npm run test:terminal
```

Use disposable fixture storage; see [e2e/README.md](../e2e/README.md). These scripts
launch only their own dev server on a free port, never the installed port 30141.
Do not launch another server while that checkout’s `.next/dev/lock` is active.
Removed Workflow E2E/containment tests are not acceptance requirements. Checks
grant no integration, publication, deployment or resource-cleanup authority.

References: [Node test execution](https://nodejs.org/docs/latest-v22.x/api/test.html#test-runner-execution-model),
[Nix cores/jobs](https://nix.dev/manual/nix/stable/advanced-topics/cores-vs-jobs),
[Next typegen](https://nextjs.org/docs/app/api-reference/cli/next#next-typegen-options).
