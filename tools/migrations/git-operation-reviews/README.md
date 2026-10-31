# Temporary Git operation review migration support

This directory currently contains **only the isolated legacy codec and synthetic
tests**, not a converter CLI. P4 owns discovery/dry-run/check/apply/resume/restore,
graph preservation, operator admission, backups and rehearsal. Nothing here
converts live state or authorizes deletion. See the [active plan](../../../docs/plans/2026-10-31_git-backed-operation-reviews-plan.md).

`legacyReviewStore(absoluteRoot)` requires an explicit root; it never calls SDK
`getAgentDir` or searches global state. Its legacy writer exists only to generate
synthetic compatibility inputs. The application must not import this subtree.
The production package/application fileset excludes `tools`; the fresh exporter
and test fileset admit only this exact migration subtree. One classified bridge,
`lib/plugins/git-operation-review-migration.test.mjs`, registers its tests.

Use the repository's pinned Node 24 Nix runner, from a source revision containing
this directory:

```sh
nix run .#test -- core --file lib/plugins/git-operation-review-migration.test.mjs
```

This focused check is not full application acceptance or a migration rehearsal.
No historical converter revision/invocation is claimed until an actual tested CLI
exists. P4 must preserve this isolation when adding that CLI.

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
package transport/layout/downloads. Complete core/browser/service acceptance,
independent P3 review, realized-package inspection and all P4 obligations remain
separately recorded gates, not implied by this ledger.
