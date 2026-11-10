# Temporary Git operation review migration support

This temporary directory contains the explicit-root Linux/Node 24 offline CLI,
isolated v1 codec and synthetic migration cases. It supports dry-run/check/apply/
resume/restore, exact per-file backups/journal and private SDK/graph validation.
It does not authorize live state conversion, repository admission or deletion.
See [migration and recovery instructions](../../../docs/git-operation-review-migration.md)
and the [active plan](../../../docs/plans/2026-10-31_git-backed-operation-reviews-plan.md).

`legacyReviewStore(absoluteRoot)` requires an explicit root; it never calls SDK
`getAgentDir` or searches global state. Its legacy writer exists only to generate
synthetic compatibility inputs. The application must not import this subtree.
The production package/application fileset excludes `tools`; the fresh exporter
and test fileset admit only this exact migration subtree. The classified bridge
`lib/plugins/git-operation-review-migration.test.mjs` registers codec, import-boundary
and metadata-refusal tests. The service VM's `vm-acceptance.fixture.mjs` registers
the complete converter matrix and genuine metadata cases.

Use the repository's pinned Node 24 Nix runner, from a source revision containing
this directory:

```sh
nix run .#test -- core --file lib/plugins/git-operation-review-migration.test.mjs
nix run .#test -- service # includes the complete positive converter matrix
```

This focused check is not full application acceptance or a migration rehearsal.
The parent records the actual tool-containing commit after committing; this source
writer does not invent a tested historical revision. Retain that revision/lockfile
before separately authorized retirement. No real dataset belongs in test inputs.

## CLI and implementation map

`nix develop --offline --no-write-lock-file -c node tools/migrations/git-operation-reviews/cli.mjs dry-run --sessions "$COPY_SESSIONS" --operations none --legacy "$COPY_REVIEWS" --output "$PRIVATE_RUN"`

The maintained guide defines exact mutation confirmations, explicit absent operation
roots, optional admissions/session-content maps, exit statuses and retained-block
dispositions. No SDK opens on originals, live services, auth/provider bootstrap,
current-ref/prose joins, patch recovery, fetch, retention refs or cleanup exist.

| File | Scope |
| --- | --- |
| `cli.mjs`, `run.mjs` | Explicit arguments; immutable manifest/mappings; private reports, backup/install/check/resume/restore journal; exact confirmations |
| `io.mjs`, `json.mjs` | Held Linux directory/no-follow regular boundaries, fsync/exclusive writes, strict duplicate-key UTF-8 parsing and exact token edits |
| `codec.mjs` | Complete aggregate/index/range/per-entry streaming integrity, orphan/pending/corrupt classification, once-only presentation normalization/reconstruction |
| `convert.mjs` | Every branch/occurrence, ancestry-only proposal sharing, occurrence-local result proof, terminal unavailable settlements, standalone inert consent, exact graph/SDK projection oracles |
| `target.mjs` | New-format leaf validators/read-only Git and leaf SDK SessionManager only; no application bootstrap |
| `converter.fixture.mjs` | All 29 B01–B22-derived filesystem/native/SDK cases, interruptions, corruption, no-follow/races, backup/write/journal/refusal and exact restore; registered unconditionally by the guest fixture |
| `metadata-refusal.fixture.mjs`, `metadata-support.fixture.mjs` | Core's actual unavailable/permission-denied FD queries, unchanged-owner CLI refusal and bounded child-failure diagnostics; private synthetic inputs |
| `vm-acceptance.fixture.mjs` | Guest-only complete converter registration plus real empty-query conversion, user-xattr refusal and POSIX-ACL refusal; mandatory title/input/identity evidence |
| `legacy-store.ts`, `legacy-store.test.mjs` | Historical compatibility codec and synthetic writer/continuing assertions only |

Original/new hashes and IDs are frozen in the private manifest, never regenerated
on resume. Terminal missing facts stay unknown; result proof is not a latest UUID
join. SDK validation uses separate private LF-framed copies to avoid SDK tail repair
of exact staging. No source/message/selection/patch size cap is introduced. Large
metadata/session objects remain resident; patch hashes use bounded buffers.
Atomicity is one file at a time, not the whole dataset. Changed/newer user writes
and unverified artifacts refuse. Reused backups re-establish held-FD and directory
fsync barriers before publication. Physical output/input aliases are checked before
artifact creation. Mutation errors conservatively report partial/uncertain state
and explicit recovery commands, never automatic rollback or zero effects.
`recorded-locators.json` is a manifest-bound PRIVATE finite locator/count report
from already validated metadata, never a repository admission or prose authority.
No mode deletes a tree, bundle, backup or residue.

Review regressions cover real outer-owned standalone receipts/no-receipt states,
positive owner-local results and v2 idempotence; complete required invocation facts;
missing historical dependencies versus available contradictions; incomplete native
action facts; actual reused-backup file/directory fsyncs and tamper refusal; physical
identity/ancestry alias predicates without privileged mounts; a private source-only
command-environment mutation/restore; and actual CLI reporting after rename failure.
The explicit local helper closure is checked independently. Pinned dependency
resolution in a private source-copy test is the only loader substitution; local
helpers/policy/I/O are real. Process-local builtin fsync observations restore ES
module bindings before teardown. Existing graph/byte/unknown/native cases remain.

## Metadata capability ownership

Nix's external daemon, not the flake's client version, controls builder syscall
policy. Newer builders deny listing; an unavailable query must remain a refusal,
not absence. The test-only child filter adds listing denials (ENOTSUP or EPERM)
without changing host policy. Core also exercises missing, signaled and failed
probe children; only that external failure port is supplied.

The original 29 converter cases retain their assertions/input matrices in the
ordinary guest process, outside a builder's filter. S3's deliberate source-mutation
fixture now adds owner-write permission only to its own copied helper files:
`copyFileSync` inherits read-only store modes. The immutable executed source is not
changed, and all identity/refusal/restoration assertions remain. The guest compares
Node's resolved executable with the declared launcher's resolved target; the public
launcher is still used for execution.

The existing service VM keeps all Home Manager proofs, its small isolated profile,
root-private hashed evidence and independent converter/service cgroup settlement.
All 32 guest cases must complete without skips; `nix/migration-cases.json` is the
reviewed title inventory, checked against source registration and actual TAP.
Hosted CI remains core/browser only. Positive conversion coverage belongs to
mandatory local `service`/`all` acceptance, not a hosted green assertion.

## Assertion dispositions at P3

Historical source is feature base `dbd6c60605908a239f50e97764fad38a23c960ca`.
This ledger records semantic assertions/input tuples, not test-count equivalence.
All native-operation authorization/exact-state/cancellation assertions are retained
in their original production owners; only obsolete archive/context presentation
mechanisms change.

| Historical owner/case | Continuing assertion / disposition |
| --- | --- |
| `lib/plugins/review-store.test.mjs:36–65`, 45-entry bundle (100-byte bodies) | `legacy-store.test.mjs` retains 40/5 paging, owner/reference mismatch refusal, all 44 patch-entry bytes, complete stream length, private 0600 mode and joined EOF descriptor closure. Runtime is no longer permitted to serve these bytes. |
| Same `:77–96`, 48 × 65,536-byte entry | Retains bounded 256 KiB preview, full byte count/stream EOF, explicit cancellation/descriptor closure, data corruption/integrity refusal. Index corruption and no-follow file negatives are additionally explicit here. |
| Same `:97–102`, unpublished failure and traversal | Retains failed unpublished staging removal, unchanged published inputs, non-TTL eviction and invalid identity refusal. This writer is synthetic/offline-only, not runtime retention. |
| Same `:36–76`, session ownership/copied parent deletion/movement, legacy HTTP | Moved to real `lib/plugins/review-provider.test.mjs` and existing RPC/metadata owners: persisted/copy ancestry, removed parent, stale/unknown header, denied/unknown owner, no SDK open/rewrite, no scan/admission, and immutable native reads. Legacy/unknown overview is unavailable; materialization is unsupported, not old HTTP bundle success. |
| `plugins/git-workflow/context.test.mjs:55–122,158–176`, immutable HEAD/candidate, mapping/types/missing objects/replacement | Continuing native content/identity/mode/binary/literal path, admission and cancellation assertions live in `review-reader.test.mjs`, `lib/git-file-context.test.mjs` and the real provider/API test. IDs come from regenerated saved-comparison inventory, not supplied-patch block order. No arbitrary paths/revisions are accepted. |
| Same `:55–72,123–157`, opaque UUID uniqueness, one-hour boundary, 64-handle eviction, 256-file cap | Retired: Git no longer registers/mints an expiring context handle. These limits would incorrectly expire authorized object-backed history. Generic supplied-patch handle shape/route validation remains in its original generic tests. No general supplied-patch feature is removed. |
| Generic `patch-context/route.test.mjs:65–159` query/error dispatch | Replacement is `app/api/plugins/bundled/patch-context-route.test.mjs`: the literal filename avoids Node's dynamic-directory bracket glob returning zero cases. Retains invalid handle/file/path/revision/duplicate keys, 0/255 forwarding and error statuses through an explicit optional non-Git capability. Git's absent old capability is asserted. Native no-write context moves to the actual saved-review route/native reader. |
| `components/BlockingCard.test.mjs:20–74,96–174` review blocks (other cases `:75–95,175–318` retained) | Real v2 overview/page/selected reads retain current observer/exact promise, same DOM selection, current callback, lazy details, escaped/bounded SSR, action/footer/fullscreen/collapse/draft/single-use behavior. Old aggregate-patch failure fallback is obsolete: no aggregate patch is loaded to render a selected file. Legacy SSR now asserts unavailable instead of archive links. All unrelated generic shell/supplied-patch/history bodies remain. |
| `ReviewAttachment.pagination.test.mjs:8–73`, both 1280/390 large data tuples | Same 45 files and exact content rows remain. The old 46th metadata entry is no longer a file; metadata has its own lazy details path. Native page boundary remains 40; selected body/continuation, raw binary-marker nonclassification, footer and no-aggregate-load assertions remain. Installed cold reads/fullscreen/native 45-file commits remain. |
| `PluginCard.preview-cleanup.test.mjs:25–293`, seven operation/resource/held-read tuples | Retains seven real Card tuples, top-level/nested five-resource data, actual Pierre preload originals/handler ownership, current observers/actions, inert repeated historical outcomes and lazy resources. Aggregate supplied-page adapter and its duplicate start/patch replay counts are retired; actual v2 Strict reads execute. |
| Same `:294–612`, both original 5,000-line desktop/mobile reader tuples | Retains exact old/new lines 50/4500 (mobile old is desktop Allow), split/unified/Before/After, line 2500, literal search, renderer recreation, reading/query/anchor restoration, per-file isolation, collapse, serialized parent remount, context 409/SAME error/raw/current callback and real interaction/outcome parents. Paged unselected contents/context are intentionally released; selected restored intent rereads immutable context rather than retaining a content cache. Mounted cancellation/default/proposal/partial/no-op cases live in `OperationReviewAttachment.test.mjs`. Review repairs additionally cover held/409/retry clean-version restoration without false absence, detached count/weight-bounded navigation retention, and actual/proposal query separation. Historical Decision does not repeat every old After/4500/2500 step: those exact content/control rows remain in the live composition and renderer leaf, while its wrapper retains its own success/error/read-only/lifecycle bridges. |
| Same `:232–285`, generic supplied-patch context/queue lifecycle | **Continuing, not retired with the Git adapter.** `components/PluginCard.supplied-context.test.mjs` mounts the actual non-Git PluginCard.patch → SuppliedPatchStack → Pierre/default opaque context queue: success, current observer/no replay, held already-admitted JSON after ignored abort, separately settled public context/action and independently joined original worker/finally/native preload work. A passive real-factory observer owns that worker even if parent forwarding is defective; no copied queue/renderer or Git TTL/archive quota. Removing only the production context-worker forwarding produces the named runtime failure. |
| Installed Git/worktree protocol | Existing native settings/approval/Stop/authority, both widths, physical drawer/sidebar/focus/Wide/fullscreen, saved native bytes and browser download remain. URLs/labels now identify metadata/view/file, not bundles/TTL handles. Git adds a real divergent merge actual-result/proposal switch and explicit empty no-op through the same viewer. New receipt IDs reject old IDs before callbacks. |

Mounted DOM proves real React behavior/complete observed work, not physical layout,
browser networking or native Git authority. Native tests use private repositories
and persisted SDK/operation owners. Installed Nix browser checks retain actual
package transport/layout/downloads. P3 independent reviews are closed. Complete core/browser/service acceptance,
P4 independent review and operational gates remain separately recorded, not implied
by this ledger or a focused migration pass.
