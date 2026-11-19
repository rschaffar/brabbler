# Historical Git operation review conversion

The one-time converter has been retired from current source. New Git operation
cards already save metadata and read their diffs from Git; they do not need this
converter. Legacy patch references retain their recorded outcomes but may show
**Legacy review format unsupported**. There is no automatic conversion or legacy
bundle reader. Converter-specific output is not a supported current review format;
reproducing conversion or reading its output requires the matching historical
software, not the current application.

The maintainer explicitly declined live old-history migration on 2026-11-19.
This is a scope decision, not a claim that live conversion or deployment passed.
The recorded real-history rehearsal converted a private copy and restored that
copy; it did not convert the originals. See the [retirement and assertion
ledger](git-operation-review-retirement.md) for closure dispositions and evidence.

## Reproducible historical source

The tested converter is in full local commit
`61f1f60d7befd8cff60dfc0a597d0b863f50bd60`, with its original `flake.lock` and
`package-lock.json`. Its recorded tool/helper identity is
`bfcd74fc8dc85c4adf7f19aee9d9b0b249eda1420e8cc451ec5582939c618d10`, using
Node **24.21.0**, SDK **1.4.0**, Git **2.55.0**, Linux, Python 3 and `flock`.
Use the entire historical source and lockfiles, not just a copied CLI or current
helpers/dependencies. No remote tag or publication is needed.

For a separately authorized historical reproduction or recovery, prepare a clean detached historical
worktree at that exact commit using the normal repository workflow. Keep all
private inputs and output outside the checkout, test exports and Nix store. Read
these files **in the historical worktree** before proceeding:

- `docs/git-operation-review-migration.md`: full CLI, preservation and recovery contract.
- `tools/migrations/git-operation-reviews/README.md`: implementation and synthetic checks.

The historical CLI supports strict UTF-8 session JSONL **v3**, Git v1 bundles,
recognized legacy Git inline cards and version-1 standalone operation records.
It writes v2 review references and version-1 `git-operation/v1` metadata inside the
existing owners. Other session versions, unknown/corrupt owners and partial graphs
remain blocked unchanged. This is not a general SDK session-format upgrader.

From the historical checkout, first prepare its pinned environment:

```sh
nix develop --no-update-lock-file --no-write-lock-file
# Use --offline as well only when every prerequisite is cached.
node --version # must be v24.21.0
```

No production application build or service is involved. The shell prepares its
own matching dependencies; do not run `npm ci`, borrow another checkout's modules
or rewrite dependency markers. Missing prerequisites are a preparation failure,
not a converter result. An ordinary Linux process in this pinned shell is required:
Nix builder syscall filtering can prevent the converter's mandatory attribute
queries. Never weaken filtering or treat an unavailable query as no attributes.

The historical synthetic matrix can be run with a private, explicitly allocated
`TMPDIR` outside the checkout:

```sh
: "${PRIVATE_SYNTHETIC_TMP:?allocate a private synthetic-work directory first}"
TMPDIR="$PRIVATE_SYNTHETIC_TMP" node --test --test-reporter=tap \
  lib/plugins/git-operation-review-migration.test.mjs
```

This executes historical converter assertions, not current application acceptance
or permission to inspect live state. The retirement ledger records the actual
historical reproduction result separately from the earlier accepted rehearsal.

## Operational authority and recovery

Retirement grants no permission to run the historical tool on real history. Any
future use requires a fresh explicit scope, all selected writers stopped, private
verified backups, exact dry-run manifest/block review and separate activation and
representative-card verification. A copied unquiesced dataset is not a consistent
live backup. The converter lock does not stop other SDK/CLI/application writers.

The historical invocation starts with explicit roots; there are no agent/home
defaults. In the pinned historical shell:

```sh
node tools/migrations/git-operation-reviews/cli.mjs dry-run \
  --sessions "$SELECTED_SESSION_ROOT" --operations "$SELECTED_OPERATION_ROOT" \
  --legacy "$SELECTED_LEGACY_ROOT" --output "$PRIVATE_RUN"
```

Repeat `--sessions` for additional retained roots. `--operations none` deliberately
selects no standalone records; it does not prove none exist. Initially omit
repository admissions/mappings. Saved paths and OIDs grant no access; any later
`--admit` or session-content-only `--map` needs its own explicit decision.
Unknown outcomes remain unknown, and unavailable content never becomes current
files or an invented actual result.

Read the complete historical instructions before apply/check/resume/restore.
Mutation requires the exact reviewed manifest hash and explicit stopped-writer
attestation; retained blocks need an exact disposition. Atomicity is per-file,
not whole-dataset. On interruption, preserve artifacts and choose recovery against
the same manifest; never automatically restore over newer writes or run an old
binary over mixed state. Binary rollback and exact state restoration must be
considered together while stopped.

## Retained state and ownership

Existing legacy stores, backups, reports and rehearsal evidence are **retained**.
No deletion is required for plan closure or authorized by tooling retirement.
The installation maintainer owns any future exact inventory, retention/deletion
proposal and recovery decision under this guide. Old-store deletion and backup
or evidence disposal are separate explicitly approved operations; no wildcard,
age-based reaper, worktree cleanup or successful conversion implies permission.

Current runtime contracts belong to [review metadata](git-operation-review-metadata.md)
and [the Git plugin](git-workflow-plugin.md#durable-review-metadata). The
[archived plan](plans/archived/2026-10-31_git-backed-operation-reviews-plan.md)
retains implementation-specific review and acceptance evidence, not current
execution authority.
