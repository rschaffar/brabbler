# Git operation review converter retirement

## Closure disposition — 2026-11-19

The Git-backed producer, viewer/API and converter were delivered, independently
reviewed and accepted at `61f1f60d7befd8cff60dfc0a597d0b863f50bd60`, integrated
through `9e7f5d093daa72b6b6fbd212275a9e7e596fafe0`. The implementation plan's
later P4 closure, not its stale index/checkpoint prose, records complete acceptance.

The maintainer reports that new Git cards work and explicitly declines migration
of old history. This is not independent installed-package verification or a claim
that live conversion occurred. The recorded real-history cycle operated on a
private copy and restored it. Unmigrated cards keep outcomes and unavailable legacy
review placeholders. New operations need no converter.

This repository-only change removes the temporary converter, legacy codec and
migration-only fixtures, core bridge, export/fileset exception and guest execution/
receipt wiring. It does not remove current metadata/reader/viewer tests or generic
supplied-patch support. No live stores, backups or private evidence are deleted;
no deployment, service operation or remote publication is included.

| Obligation | Disposition / current owner |
| --- | --- |
| Implementation, independent review and original full acceptance | Delivered; archived plan preserves exact candidate/input evidence. |
| Local source integration | Confirmed through merge `9e7f5d093daa`; this retirement uses its own verification and integration gates. |
| Live old-history conversion and conversion-specific activation/card checks | Deliberately not pursued, not marked passed. No further migration task. |
| Old-store, backup and private-evidence disposition | Retained; installation maintainer owns any future separately approved exact proposal under the migration guide. No pending deletion requirement. |
| Temporary converter/tests | Retired from current source; historical reproduction recorded below. |
| Current operation-review behavior | Maintained by the metadata and Git plugin guides; normal application acceptance remains required. |

No successor spec/ticket is needed: migration is declined and repository retirement
is this bounded change, not deferred work. The [historical migration guide](git-operation-review-migration.md)
owns any future recovery request and explicit retention permissions.

## Retirement verification

Independent source/safety review closed with no remaining findings, including the
mixed service assertions, package/export wiring and closure documentation. A
focused Nix selection passed **41 tests / three files**, plus **34 exporter
contracts** and static checks. Its first run exposed an overbroad architecture
regex that rejected the legitimate installed `lib/node_modules/brabbler` path;
the corrected guard rejects only the retired source/modules inputs. That failure
is retained, not relabelled as a passing run.

Fresh complete acceptance passed on committed candidate
`a9df8cb86e588488769872d7faf92f944c522808` with:

```sh
nix run --no-update-lock-file --no-write-lock-file .#test -- all --workers 4 --jobs 12
```

On x86_64 Linux / Node 24.22.2, all **544 core files / 4,909 tests / 14 suites**,
**26 browser/terminal groups** and **five genuine Home Manager deployment checks**
passed. Core had zero failures, skips or cancellations. Declared-input static
checks passed with seven existing nonfatal lint warnings; exporter contracts
passed 34 cases. Requested/effective widths were **12/12 core, 4/4 browser**, with
32 CPUs and about 61 GiB available at admission; core/browser overlapped.

End-to-end command wall was about **340 s**, including in-run realization. Core
was **296.349 s** (2.531 s before-first-file envelope; 293.333 s file window).
Browser was **266.273 s**, including 4.201 s support and 6.060 s definition
preparation; its group-client window was 256.009 s. Deployment was **67.057 s**,
including 19.215 s guest acceptance; a separate realization interval is not exposed
in that report. Overlapping intervals are not additive. Focused-run preparation
and available cached package/static prerequisites preceded this command; this is
not a cold-cache benchmark or a comparison with the original rollout.

Outer source identity is
`3045c92b08bd7d732228436b4479ce1edc1cc24cb82c0f23b8d5be3dff5b19ad`, inner
core identity
`62905fecc1dc8ee6fd8c556026f0c2729287b50d9578920d5c769b0b02c3454a`.
The immutable core report is in
`/nix/store/qn41pb425rffs4hbg13d01qgcmfgr7p2-brabbler-core-checks`;
source-bound outer/browser/guest reports and failures remain private. Browser and
VM used the same installed package, which read-only evaluation also matched to
unchanged local main: no application artifact change. The guest registry/evidence
contains five checks and four artifacts with no converter process/receipt.

This evidence-only follow-up does not claim a second full run on a later commit.
Local Markdown target-existence, whitespace and public-safety checks accompany
closure; these are source checks, not browser link-opening verification. Local
integration retains its exact-state gate; no live operation follows from acceptance.

## Historical reproduction

A clean detached worktree at `61f1f60d7befd8cff60dfc0a597d0b863f50bd60`, with its
original lockfiles, reproduced the recorded tool/helper identity
`bfcd74fc8dc85c4adf7f19aee9d9b0b249eda1420e8cc451ec5582939c618d10` on Linux
with Node 24.21.0, SDK 1.4.0 and Git 2.55.0.

`nix develop --no-update-lock-file --no-write-lock-file -c node --test
--test-reporter=tap lib/plugins/git-operation-review-migration.test.mjs` passed
**34/34** historical cases: four legacy codec, 29 converter and one import-boundary
case. A separate synthetic session/standalone CLI cycle passed **11 steps** covering
all five modes, pending check, wrong-confirmation refusal, target-format idempotence,
repeated restore and resume-after-restore refusal. Exact original bytes and modes
were restored. These are synthetic reproduction results, not live migration or
current application acceptance.

Initial offline preparation failed on an uncached shell prerequisite before any
converter test ran. Normal configured Nix substitutions then prepared the unchanged
source in **82 s**. Verification took **31 s**: the matrix **23.538 s**, direct CLI
cycle **7 s**. The earlier failure is retained privately; no source fix is claimed.
The historical checkout remained clean. Private commands, driver, TAP, runtime/
source hashes and per-mode receipts are retained outside tracked repository files.
The migration guide gives the reproducible historical entry point; do not copy
current helpers into the frozen converter.

## Retirement assertion dispositions

Coordinates refer to immutable source `5e04c8f06aa419c2ed9b65cdf4634264cddab6c4`.
Removal is intentional obsolescence, not a claim that current code still converts
history. The complete original converter assertions remain in the historical source.

| Original owner / inputs | Disposition and continuing proof |
| --- | --- |
| `tools/migrations/git-operation-reviews/*`, classified bridge and `nix/migration-cases.json` | Remove the old codec, converter/metadata-refusal and guest-only matrices with their feature. Historical `61f1f60d` reproduction above retains a runnable recovery path. Current Git reference/schema/provider/reader/native/SDK/viewer tests remain. |
| `lib/nix-service.test.mjs:17–141` registry/plan/passed/failure fixtures | Remove only converter registry/proof/settlement/check/artifacts. Keep all five actual deployment checks and their original negative tuples; add rejection of retired migration fields/check/TAP against otherwise valid receipts. |
| Same `:143–165,258–304,338–491` native artifact, environment, HTTP/PTY diagnostics and actual driver cases | Retain missing/changed/symlink/hardlink/root-alias refusal, private diagnostics and original errors, bounded HTTP/SSE, existing-channel boot-failure collection, safe journals despite unsafe helpers, guest hashing before copy and transfer corruption refusal. |
| Same `:167–256,492–543` 29+3 guest titles, converter proof/TAP/identity and converter-unit settlement | Obsolete with the deleted guest converter process. No skips replace positive execution. Real Home Manager unit, native PTY, service generation, client uncertainty, authenticated cgroup/port settlement and outer owned-execution gates remain. |
| Same `:306–336` deployment architecture | Replace converter source/modules/unit/closure presence with absence assertions. Retain restricted network/resources, no host mount/forwarding, real HM service, generic artifact validation before publication and execution/evidence cleanup gates. |
| `nix/export-test-source.test.py:156–165` exact converter subtree and unrelated private tools inputs | Replace converter admission with exclusion/no-traversal sentinel. Keep sibling-tool exclusion and all other exporter identity/race/integrity/third-party allowlist cases. No `tools` subtree enters current test or application exports. |

The service VM retains **five** genuine deployment proofs and **four** mandatory
artifacts (journals, observations and fixture archive). Root-private staging,
no-follow/special-file tree refusal, guest SHA-256 before transfer, host verification,
independent safe diagnostic attempts and uncertain-settlement refusal remain.

## Current-reader cleanup dispositions

The maintainer withdrew current-runtime readability of converter output. The
converter's tested revision, original acceptance and historical reproduction above
remain evidence for that software only. Reproducing those assertions or reading
converter output requires matching historical software. There is no migration,
rewrite, deletion or new recovery task in the current-reader cleanup.

Coordinates below refer to `4ce29a13f903d9663cd6e5e6651721b34fc3403a`.

| Original owner / inputs | Disposition and continuing proof |
| --- | --- |
| `plugins/git-workflow/review-reader.test.mjs:307–308`, second SHA-256 repository patch download | Drop only the 64-character hash-length assertion and redundant stream. Keep the SHA-256 endpoint, inventory, patch content, immutable context and relation assertions (`:300–306`), and the independent full-byte native/API streaming and cancellation checks. |
| `plugins/git-workflow/review-data.test.mjs:87,101–127`, offline binding, 5,000 legacy artifact rows / 2 MiB details, incomplete import outcomes | Imported shapes are now refused, not coerced to current metadata or fabricated results. Keep full structured resource/check round trips (`:160–167`) and add a current result-capture failure case that retains verified OIDs without serving a result. |
| Same `:129–153`, converter result basis for commit/rebase/merge, frozen args/OID/branch correspondence and coexistence refusal | Imported result bases are rejected outright. Current links still require the original baseline and verified postflight; retain native method, exact-state, SDK and ancestry tests. |
| Same `:211–224`, shared legacy/current check and discard members | Retire only legacy acceptance and duplicate legacy validation. Exercise the original valid/invalid check and discard tuples against the current proposal decoder. |
| `plugins/git-workflow/review-presentation.test.mjs:13–62` and `resource-rules.test.mjs:38–48`, full-card intermediate, budgets 1/2/4 and 24/25, and uncapped 25/100 selections | The full presentation is obsolete. Retain immutable captures, essential rows, budget rejection and exact totals; check bounded production cards and complete structured metadata separately. Add observable omitted-row and eager-operation-JSON controls, not just short-output checks. |
| `lib/plugins/review-provider.test.mjs:87–122,150–182,226–240,274–306` | Keep independent owner/receipt/review IDs, recorded rename relation, pre-header selection refusal, disabled history, distinct owner anchor/content checkout, and denied/missing anchor. Consolidate setup only. The inert v1 unsupported placeholder still does not fetch a bundle; converter-specific v2 payloads fail closed. |

Generic supplied patches and notebooks, the viewer and all five genuine service
checks keep their existing coverage. The changed tests require fresh candidate
acceptance, not the historical runs above.

## Historical support snapshot

The remainder preserves the removed README and its P3 assertion ledger from
`5e04c8f06aa419c2ed9b65cdf4634264cddab6c4`. **Paths, commands and pending-gate
wording below describe that historical source only**, not current tool availability
or new work. The closure and maintained historical guide above govern current use.

This temporary directory contains the explicit-root Linux/Node 24 offline CLI,
isolated v1 codec and synthetic migration cases. It supports dry-run/check/apply/
resume/restore, exact per-file backups/journal and private SDK/graph validation.
It does not authorize live state conversion, repository admission or deletion.
See [migration and recovery instructions](git-operation-review-migration.md)
and the [archived plan](plans/archived/2026-10-31_git-backed-operation-reviews-plan.md).

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
