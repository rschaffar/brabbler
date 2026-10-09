# Per-invocation test workspaces and shared Nix dependencies

## Decision

Automated Linux core and browser/terminal acceptance isolate each invocation, not
merely each Git worktree. Independent reviewers can use the same checkout while
running from separate verified, filtered snapshots. Source writers pause during
export; subsequent edits do not become inputs to an already exported run.

Nix owns manifest/toolchain/platform-keyed dependency outputs. Core snapshots
link to immutable store modules; type generation, lint, typecheck and native Node
tests have passed with that layout. Turbopack acceptance still gets an independent
local dependency copy because its workspace resolution differs. Manual development
continues using the existing worktree-local dependency preparation policy.
The `test` shell avoids that checkout mutation. A single immutable descriptor
binds browser dependency modules and source-manifest hashes; plain npm acceptance
checks installed lock metadata and manifest declarations before copying.

Run owners remove only their own dependency link/copy, generated `.next`, and
Node compile cache after observed settlement, regardless of assertion outcome.
Artifacts, manifests, source snapshots and failed fixture state remain. Explicit
`--keep-workspace`, interruption, uncertain observations, replacement identities
and mountpoints retain bulk. This policy grants no cleanup authority over old
runs, user checkouts or feature resources. Reports are not Nix GC roots.

## Rationale and limits

Retaining roughly one GiB of dependencies after every run caused the historical
buildup; it was not a failure of Nix dependency caching. Ext4 cannot reflink these
copies, and hardlinks would share mutable inodes. Core store links avoid copies;
settled-run cleanup bounds browser copies by active/explicitly retained runs.
No mounts, filesystem migration, package-manager change or global scheduler are
needed for this design.

Snapshots exclude `.env*` and private/generated paths, unlike merely clearing a
process environment and running Next in a populated checkout. They also isolate
`.next` and permit acceptance alongside a manual dev server.

Process observation authenticates original Linux identities and performs bounded
session scans. It is not OS containment or certification of unobserved escaped
descendants. On interruption, outer escalation also covers observed detached
children before their owner. An unresolved resource prevents cleanup; a passing
assertion is not a settlement certificate.

Worker admission remains per runner, not a machine reservation. Concurrent jobs
need conservative CPU/RAM budgets. Cacheable Nix checks remain declared-input
evidence, not fresh browser acceptance. Non-Linux legacy acceptance is explicit
`--in-place`, without the new concurrency or bulk-cleanup guarantee.

Operational commands and retention details belong in [testing](../testing.md)
and the [browser guide](../../e2e/README.md).
