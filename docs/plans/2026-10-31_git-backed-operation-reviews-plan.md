# Git-backed operation reviews

**Status:** Implementation authorized. P1 reader/metadata foundation is independently
reviewed and core-verified. P2 host/producer integration now saves metadata and v2
references instead of new patch bundles; focused host/SDK/native/standalone checks
pass. Two independent P2 reviews are closed after persistence, copy-barrier,
nested-schema and started-wrapper containment repairs. The full viewer/API is
**not yet wired**:
attachments currently show explicit pending/unsupported placeholders, with shared
viewer controls retained for P3. Migration tooling and complete acceptance remain
open. Live migration, activation and old-state deletion require separate authorization.

**Workspace:** `feat/git-backed-operation-reviews`, created from local `main`
`fed9415359e3867a3c9bdd25801034d6e5c820ee`; reviewed planning commit `ee32fb3f`.
Retain this linked worktree while the implementation packages are incomplete.

## Executive summary

Keep today's file-by-file diff viewer, but load its contents from Git instead of
keeping permanent patch copies. Store the exact Git references and operation details
in sessions, or existing records for the standalone worktree manager.

Show what actually happened. If the proposal differed, offer **View original
proposal** in the same viewer—no comparison dashboard. If Git data is missing,
say so instead of showing current files.

Convert old history with a one-time offline tool: dry run, backups, verification
and clear reporting of unavailable diffs. Keep legacy code inside that tool, then
remove it after the real migration is verified. Leave instructions pointing to its
Git revision. Deleting old stored data remains separately approved.

## Goal

Remove the permanent duplicate patch archive while preserving the current useful
review experience, exact-operation safeguards, truthful outcomes and readable
historical cards. Let Git own source content and ordinary object retention.

Success is **less persistent content and fewer storage mechanisms**, not merely
moving the same patch files into sessions, a different directory, hidden Git refs,
a bare archive repository or a new cache service.

## Plan relationship and decision ownership

- This plan owns the Git card review source, result/proposal presentation, offline
  conversion and retirement of the old review-store path.
- [ADR 0018](../adr/0018-size-independent-git-reviews.md) currently requires
  repository-independent immutable patch bundles. Implementation must add a new
  ADR explicitly superseding that storage/availability choice. Preserve its
  separation of approval scope from display size and its streaming/large-input
  protections. Do not quietly contradict the accepted ADR through code alone.
- Preserve [Git plugin](../git-workflow-plugin.md) execution/receipt contracts,
  [session contracts](../session-internals.md), and
  [worktree diff controls](../worktrees.md#full-file-diff-review).
- Preserve ADR 0016 receipt/policy separation, ADRs 0017/0019 cleanup safety, and
  ADRs 0021/0022 standalone hosting and loss acknowledgment. This is not a redesign
  of Git authorization, cleanup eligibility or conflict resolution.
- The active Explorer fullscreen plan owns Explorer layout/history work; this
  plan reuses its diff components but does not take over that queue. The active
  core-test optimization plan owns deferred performance work, not this storage
  replacement. The public-release plan retains publication/platform gates.
- [Testing](../testing.md), [test writing](../test-writing.md) and
  [browser acceptance](../../e2e/README.md) own verification. A new test framework,
  extra baseline or development-server acceptance is not part of this work.

### Visible correction to the earlier approach

Optimizing the old archive through patch deduplication was considered, then
superseded by the agreed product decision: historical diffs may become unavailable
with their repositories or Git objects. Do not introduce deduplication or permanent
object pinning to recreate the guarantee that is being removed.

## Grounded current state

Source was inspected at the starting revision above; these are implementation
facts, not claims that the proposed replacement has been tested.

| Owner | Current behavior / implication |
| --- | --- |
| `plugins/git-workflow/server.ts` | Commit preparation builds a private candidate index and writes its Git tree. Merge/rebase proposal compares captured merge base and feature tip. Inputs and relevant policy are revalidated before effects. |
| `plugins/git-workflow/review.ts` | Writes operation JSON and a streamed `git diff --binary` into a durable bundle, then compacts the visible card. |
| `lib/plugins/review-store.ts` | Stores `data`, `entries`, `offsets`, `manifest.json`; verifies integrity and serves bounded pages/streams. Published bundles do not expire. |
| `lib/plugins/review-access.ts` | Authorizes session reads through saved operation/interaction references, including copied history. It does not depend on a live session wrapper. |
| `components/plugin-ui/ReviewAttachment.tsx` | Both inline file diffs and downloads use those bundles. Removing download links alone saves no storage. |
| `plugins/git-workflow/postflight.ts` | Already observes result commit/tree/parents and checks candidate matches. Structured result facts reach tool details, but durable card summaries are bounded strings; do not assume every old card contains complete structured result metadata. |
| `lib/plugins/project-operation-{host,store}.ts` | Standalone manager persists operations outside sessions, including receipts and historical acknowledgment. Its review path must be converted too. |
| `lib/git-explorer.ts` | Has reusable immutable-object parsing/reading patterns, but its public readers require a current branch/reachability anchor and have aggregate output limits. They cannot be reused wholesale for uncommitted trees or abandoned historical commits. |
| `plugins/git-workflow/context.ts` | Full-file context uses expiring in-memory handles. An object-backed reader can reuse the underlying context function, not make history depend on a one-hour handle. |

The production writer search currently finds the Git Workflow plugin as the
bundle producer. Confirm this at implementation time, including paused card
snapshots and standalone project operations, before deleting the generic store.
Do not confuse this store with review notebooks or their separate state.

## Product contract

### Existing viewer stays

- Retain per-file navigation, desktop sidebar/mobile file drawer, split/unified/raw
  modes, wrap preference, search, change navigation, full-context loading and
  fullscreen/Wide behavior. Preserve keyboard/focus/Escape and action-footer rules.
- Pending cards display the immutable proposal, not the current index/worktree.
- Completed commit/merge cards display the observed result by default when a
  trustworthy result comparison was captured. Use the same viewer for the proposal.
- When the two comparisons differ, show a neutral note and **View original
  proposal**. A simple return to **Actual result** restores the default view.
- Do not add a side-by-side proposal-versus-result dashboard, semantic change
  analyzer, separate viewer, automatic recovery or new Git policy options.
- A legitimate divergent merge is not automatically an authorization violation.
  Neutral wording must not equate different integration results with stale approval.
- A missing result must never silently display a proposal under an actual-result
  label. Clearly label **Original proposal** / **Actual result unavailable**.
- Existing generic supplied-patch cards from other producers remain supported;
  removing the Git bundle archive does not remove `PluginCard.patch` generally.

### Operation and outcome cases

| Operation/state | Proposal | Result/default after trustworthy observation |
| --- | --- | --- |
| Commit | Captured HEAD tree -> captured candidate tree | Captured parent -> actual commit, after the existing parent/candidate checks; unrelated staged/working changes remain excluded. |
| Merge | Captured merge base -> captured feature tip | Captured target tip -> actual resulting target, including FF/non-FF/no-op. No-op is an explicitly empty result, not the proposal. |
| Rebase | Captured merge base -> old feature tip | Captured target -> observed rebased feature tip, labelled **Rebased feature changes**; this is the rebased feature's delta, not a claim that old-tip -> new-tip contains only the feature's edits. |
| Rejected/cancelled/check failure before native effect | Captured proposal, if objects remain | No successful result is invented. Keep existing authorization/outcome labels. |
| Native failure, conflicts, partial operation or uncertain reporting | Captured proposal, if available | Show recorded outcome/uncertainty and any explicitly observed result only with its limited status. Never infer success from today's HEAD. No automatic continuation or replay. |
| Create/attach/remove worktree, cleanup/discard | Exact structured operation/resource metadata | Existing outcome/presence observations; no fabricated patch. Large selected-resource lists remain inspectable. |

A successful native effect with failed final receipt persistence remains a reporting
failure, not a failed/rolled-back mutation. Do not repeat it to obtain a review.
Fresh display reads cannot upgrade an old unknown outcome into recorded success.

## Architecture

### 1. Persistent data: metadata only, in existing owners

Introduce a new review-reference version rather than interpreting the old UUID
bundle reference as if it meant a Git comparison. Proposed boundary:

```ts
// Generic, small card reference; final exported names follow existing conventions.
type OperationReviewReference = {
  version: 2;
  id: string;
  operationId: string;
};

// Host-owned metadata envelope; plugin validates its own payload.
type OperationReviewRecord = {
  version: 1;
  id: string;
  pluginId: string;
  operationId: string;
  format: string; // e.g. "git-operation/v1"
  payload: unknown; // serializable metadata, never patch/blob bodies
};
```

For session operations, a dedicated custom entry (proposed type
`brabbler:operation-review`) stores the metadata once. Stage receipts carry the
small reference, rather than repeating full selected-file/resource lists. The
record contains the exact operation, full message/selection/check definitions,
captured repository binding, proposal comparison and relevant technical metadata.
Do not serialize both an unbounded presentation copy and the same full operation
lists when one structured source can supply the details view.

The proposal record is immutable and durably saved **before** publishing its card
or any prepared/authorization receipt that references it. Settlement may append a
second immutable record containing the observed result and a reference to the
proposal record; the final receipt points to that result record. Avoid a mutable
latest-by-operation lookup that can import a terminal result from another session
branch. A copied final receipt must copy its referenced proposal/result records.

These records are hidden UI metadata, not assistant messages, provider input,
replayable tool calls or new authority. They use ordinary SDK session-tree entries
and survive move/fork/clone through the existing ownership mechanisms. Ensure
forking at a receipt copies all preceding required metadata; preserve original
entry IDs, parent links and receipt sequence behavior.

For standalone project operations, put the same metadata inside the existing
operation JSON owner. It is a deliberate exception to session-only storage because
there is no session. Keep one operation-owned proposal/result structure, not a new
folder or a second metadata database. Preserve its private atomic persistence and
restart/no-replay behavior. Keep the host owner/request ID distinct from the Git
receipt operation ID and review ID; the real executor does not equate them.

Explicitly exclude full persisted review payloads from standalone status/list
responses. `publicRecord` currently returns almost every stored field, so merely
adding metadata to storage would otherwise send it repeatedly during polling.
Return compact references/summaries there; the authorized paged details/download
reader alone supplies complete message/check/resource metadata.

**Size boundary:** compact card validation must still be independent of full review
metadata. Put full resource/message/check details outside the bounded card envelope;
page them on read. There is no new operation limit based on patch size or selection
count. Verify how the SDK copies/loads large custom entries in P1; use bounded
metadata parts if necessary, not a silent truncation or hidden patch-store fallback.

### 2. Repository binding and historical availability

The Git payload records full object IDs (SHA-1 or SHA-256), endpoint tree IDs when
resolved, and a captured physical common-Git-directory binding plus an allowed
checkout locator. Branch names are descriptive only. A browser never submits raw
revisions, Git paths, arbitrary repository directories or a desired comparison.
It submits the saved review ID, permitted view and server-issued file/page identity.

On each read:

1. The generic host authorizes the saved session/project reference and plugin owner.
2. The Git provider locates an independently allowed surviving checkout of the
   captured repository. A deleted feature worktree does not lose history if the
   same common repository remains accessible through another known checkout.
3. Validate physical repository identity, object format/types and exact endpoints.
   Recheck identity around awaited reads. A new repository at the same path must
   not be adopted merely because a directory or branch name matches.
4. Generate only the saved comparison. Current HEAD, index and working files do
   not define historical content; branch movement alone does not stale the view.

Use the existing path-security boundary, Windows/UNC identity normalization and
known/allowed project roots. No home-directory scan, remote URL matching, automatic
fetch, arbitrary cross-project fallback or global repository registry is added.
Session relocation does not rewrite historical repository identity to the new cwd.
Moving an entire repository or restoring a different physical copy may make reads
unavailable; an explicit offline repository mapping can be supported by the
migration tool, without adding a runtime rebind UI in this change.

Standalone history retains its existing allowed physical-anchor admission before
content resolution. A surviving feature-independent anchor can authorize reads;
a missing/denied owner anchor cannot be bypassed inside the Git reader. Retain the
record but deny owner access when no independently authorized anchor survives.
The promise that a card can show an unavailable diff applies only after its owner
can be accessed; retained state is not an unconditional standalone history browser.

An object ID is an identifier, **not** a Git retention ref. Do not create permanent
hidden branches/tags/refs, replace refs, history pins or a separate object archive.
Candidate trees already written by commit preparation can remain unreachable.
During a live approval, missing objects expire/refuse that proposal and require
fresh preparation/approval as applicable; never swap in a new candidate. Check the
originally captured objects before re-running preview: selected-file preview can
otherwise recreate a missing tree with the same ID, masking its disappearance.
This is a narrow availability check, not a new retention mechanism. Reconnect
within the same live invocation may continue under existing rules. Restart does
not restore execution authority. Rejected, rebased-away or abandoned objects may
later be collected; the card remains, with an explicit unavailable diff.

### 3. Materialization stays in the optional Git plugin

Keep generic chat and host code unaware of Git revisions or merge semantics. Add
an explicit bundled-plugin review-reader capability: the generic host resolves an
owned metadata envelope and dispatches to its registered format/provider. Unknown
formats render unavailable details, not guessed content. A disabled plugin's
registered read-only history provider may still serve history under existing
ownership/access rules; disabling never restores mutation authority.

Proposed Git owners are `plugins/git-workflow/review-data.ts` (payload validation,
comparison selection and result relation) and `review-reader.ts` (local Git reads),
with a generic metadata owner under `lib/plugins/`. Names are provisional; keep the
module boundary, not a required file-count convention.

Reuse/extract tested low-level full-OID, NUL-framed file inventory and
`readGitFileContext` helpers where appropriate. Do not weaken Explorer's branch
reachability rules just to support card history; card reads have their own saved
reference authority and can legitimately address candidate trees/unreachable commits.

All reader commands are local and sanitized: no external diff/textconv, replacement
objects, signature verification, hooks, fsmonitor execution, lazy network fetch,
checkout/index writes or application-managed Git refs. Use literal pathspecs and
full validated object IDs. File requests must select members of the server-derived
comparison inventory, including rename/delete paths; never arbitrary blob reads.
Git configuration/attributes must not silently alter which immutable content is read.

### 4. Bounded reads, existing UI and downloads

Replace permanent indexes with generated file inventory/pages. Retain the existing
40-item page and 256 KiB raw-preview behavior unless a separately justified UI
change is needed. Read selected file patches lazily; do not generate/store the
whole repository patch merely to render a small selected file. Preserve binary,
rename, mode-only, deletion, symlink and gitlink descriptions and literal unusual
filenames. A deterministic explicit rename policy must be shared by inventory,
selected-file patches and comparison relation; do not accidentally change display
semantics through ambient Git config. Include rename-chain/path-reuse fixtures so
a path-filtered patch cannot return a different pair than the global inventory.
Pin gitlinks to descriptive, non-recursive output (for example `--submodule=short`)
and verify hostile ambient submodule-diff settings cannot broaden read scope.

Large individual file patches still have bounded raw previews and a complete
streamed download. Full-patch download streams directly from the captured Git
comparison, including binary data. Metadata download reads the structured record.
If keeping a combined review download, generate it from those sources on demand;
label proposal/result explicitly and do not promise byte-identical historical
formatting across Git versions. There is no need to preserve the misleading
wording **complete exact review** as an archival guarantee.

No persistent patch/index cache. Any in-memory inventory/navigation cache is
bounded, keyed by repository identity + immutable tree pair + view, and loses no
authority on eviction. On cancellation/disconnect join and close owned Git children
and pipes. Large-output preview bounds cannot become native-operation output caps.
Do not reuse Explorer's 1 MiB patch subprocess limit for complete card downloads.

Use the same full-file context source as the selected comparison, with existing
1 MiB-per-side / 50,000-combined-line limits. Do not make historical reads depend
on the old expiring context handle or change unrelated supplied-patch context APIs.
Switching proposal/result cancels stale reads and scopes file selection, expansions
and reading positions to that view; late responses cannot replace the new view.

Unavailable states distinguish missing repository/objects, denied access,
unsupported format and failed read. If one comparison works, keep it usable when
the other is missing. Never call a partial stream a complete successful download.
If objects disappear during a stream, terminate with an error; do not fill gaps
from current files. Review read errors never remove the card/action footer, grant
approval, or narrow what an existing approval covers.

### 5. Simple proposal/result difference rule

The result is the default. Only expose the proposal switch as an alternative when
the captured file-version changes differ, or explain that comparison is unavailable.
Do not compare commit IDs alone: a commit and its tree can describe identical
changes despite different identifiers.

First use cheap exact tree-pair equality / verified commit-candidate relationships.
Otherwise compare deterministic **changed-file records**: literal path(s), old/new
mode, old/new blob or gitlink IDs and change type, from NUL-framed raw Git output.
A streamed digest of the canonical records suffices; no patch persistence or text
semantic analysis is needed. Ignore unchanged files elsewhere in the endpoint
trees. Use one explicit rename policy and ordering for both comparisons.

Define relation as `same`, `different` or `unknown`. `same` means the same captured
per-file old/new versions and modes, not merely equal final trees or equal commit
messages. `different` is informational, not an authorization verdict. Missing
objects mean `unknown`, never fabricated equality. The relation can be recorded
with the result when observed, or computed read-only later; it must not gate or
reclassify a known completed native effect. Tests must cover disjoint target
changes, overlapping edits, mode/binary changes and identical edits under new IDs.

## Offline migration and retirement

### Scope and location

Create a self-contained `tools/migrations/git-operation-reviews/` with CLI, README,
legacy schemas/readers and synthetic tests. Application code must never import it;
the tool may import narrowly scoped **new** validators/writers if its historical
revision remains runnable as a unit. Keep old bundle hashing/index parsing and
old inline-card conversion here rather than keeping a v1 bundle service in production.
Record the Node/runtime and exact invocation in its README. The current runner does
not discover `tools/` tests: use a small classified bridge such as
`lib/plugins/git-operation-review-migration.test.mjs`, admitting only the exact
converter subtree into fresh export and Nix test inputs. Generate patch/binary/JSONL
fixtures in private temporary directories; do not broadly admit all `tools/`, data
extensions or an ad-hoc host test baseline. Check package/fileset inputs explicitly
so migration fixtures and compatibility code do not ship as runtime modules.

A short maintained migration guide will outlive tool removal and name the actual
full commit containing the tested converter, the supported input/output versions,
its runtime, and how to run it from a separate historical worktree against a stopped
installation. No remote tag/publication is required. Do not leave an invented
placeholder revision in final removal instructions.

### Discovery and dry run

The tool requires explicit session roots, standalone operation root, old review
root and a private output/backup destination. It must not inspect credentials or
search arbitrary unrelated directories. Reports can contain sensitive source paths
and stay outside the public repository.

Discovery/dry-run uses an independent byte-preserving JSONL reader, not
`getSessionEntries()` / `SessionManager.open()` on originals: SDK loading can itself
migrate/rewrite older session versions. Declare supported input session versions;
refuse unsupported versions without changing them. Run target-SDK validation only
on staged/private copies. Raw source files must remain hash-identical after dry run.

- Enumerate every retained session file, including archived sessions, subagents,
  forks and **all tree branches**, not just visible/latest receipts. Inspect both
  `brabbler:operation-receipt` and plugin-card interaction receipts, plus legacy
  inline Git cards. Classify any other reference owners found in P1 before cleanup.
  Paused-card `waiting` snapshots are inert serialized strings later emitted as
  cancelled-card context, not executable/clickable review owners. Preserve those
  strings and pause generation/leaf unchanged; do not scan/rewrite their embedded
  UUIDs or already persisted model messages. If another auxiliary owner genuinely
  needs conversion, require its explicit input path rather than scanning agent state.
- Enumerate standalone project operations, including incomplete/rejected records
  and historical loss-acknowledgment data. They are not discoverable through sessions.
- Identify each rewrite occurrence by owner file/session identity, original entry
  ID/stage and exact reference field, plus review/operation/plugin IDs. Shared
  proposal metadata may be deduplicated within an owner; result facts are never
  joined globally by operation UUID. For standalone records, keep host owner/request
  ID separate from receipt operation ID and review ID. Validate old manifests,
  data/index hashes, entry ranges/kinds and no-follow regular-file assumptions before
  using their metadata. Read/hash patch bodies as bounded streams, not giant strings.
- Collect original comparisons and exact operation details from validated bundle
  metadata. Old inline cards may lack endpoint information: report that fact instead
  of parsing human labels such as HEAD/Candidate into present-day revisions.
- Use only full captured endpoint IDs and independently allowed repository roots.
  Old bundle metadata does not contain the original physical repository binding;
  its opaque fingerprint cannot recover that fact. Distinguish `captured` binding
  provenance for new records from `offline-admitted` binding observed/approved by
  the operator during conversion. Never label a newly observed identity as original
  physical proof. Without an admitted binding, preserve trusted OIDs/details and an
  unavailable descriptor; do not guess identity from basename/remote/current cwd.
- An optional explicit old-path -> new-path map is limited to session review-content
  bindings and must be admitted by the offline operator. This converter does not
  automatically rewrite standalone `project`/`anchor` ownership or its historical
  input/consent digests. Report inaccessible standalone owners separately; a content
  path map cannot bypass their saved host admission. Broader owner relocation is
  outside this bounded conversion.
- Validate available object types and captured endpoints. Comparing regenerated
  patches with old patches is an optional diagnostic only: legacy generation did
  not freeze every diff/rename setting. Classify formatting-policy differences
  separately from wrong endpoints/corruption, never claim unchecked byte equivalence,
  and do not recreate objects from saved patches. Recovery of all raw patch bytes
  is not a migration gate.
- Recover result facts for the exact terminal receipt occurrence and original
  branch, from correlatable structured persisted postflight/tool-result data and
  validated relationships. A prepared/uncertain fork must not inherit a later
  parent/sibling result just because UUIDs match. A demonstrably copied terminal
  receipt can share proven terminal facts. Do not depend on today's branch tips,
  guessed commit-message matches or arbitrary prose parsing. Missing proof means
  proposal-only/result-unavailable, even when a success label was recorded. Preserve
  native-success/reporting-error distinctions (`isError: true`, `completed: true`)
  and failed final-receipt persistence without manufacturing a new outcome.

Dry-run results classify each owner/reference as recoverable, proposal-only,
metadata-only, objects/repository missing, corrupt, unsupported, duplicate/conflicting
identity or unreferenced bundle. Summarize counts and affected owners, distinguish
expected unavailable history from migration errors, and list anything requiring
operator disposition. Corrupt/unrecognized input is not silently discarded.

### Safe conversion

1. Require Brabbler and any other writers of selected state to be stopped. The
   operator explicitly confirms this precondition; input fingerprints are rechecked
   before each installation. An advisory tool lock alone does not exclude other Pi
   writers. Concurrent changes stop conversion rather than overwrite them.
2. Make private verified backups of every file to be rewritten; preserve modes and
   record original hashes. Keep original bundle data untouched through validation.
3. Stage complete replacement files and a private manifest. Preserve unrelated
   JSONL line bytes, session headers/paths, IDs, parent links, timestamps, SDK
   messages, tool results, branch structure, receipt order/sequence and outcomes.
   Insert new metadata before its referencing entry and repair only the necessary
   parent edge(s), documenting those exact structural changes. The graph oracle is:
   removing inserted metadata nodes and splicing their parent edges reconstructs
   the original graph. Original entry ordering/IDs, non-reference fields,
   compaction/context-edit/label targets and the reopened active leaf stay unchanged.
   Preserve original physical last-entry identity; do not append a new metadata leaf
   after it. Compare model-context projections and receipt selection at the original
   branch points on private copies, not just JSON parsing. Do not rewrite provider
   signatures or mutate the meaning of existing model messages.
4. Rewrite every matching historical card reference, not only the displayed latest
   stage. Identical copied references become self-contained in each surviving session.
   Conflicting payloads under one identity refuse; no cross-session global lookup is
   required after conversion. New reference IDs use an idempotent manifest mapping.
5. For missing Git data, preserve card/outcome with a new explicit unavailable
   descriptor and retained identifiers/reason where trustworthy. This is a valid
   migration result, not a reason to retain the old production reader indefinitely.
   Preserve approved/rejected/check/uncertain labels; migration is not verification
   that the original operation executed.
6. Migrate standalone records atomically under their existing owner. Preserve input
   digest, original decision/acknowledgment digest and timestamps as historical
   evidence; do not recalculate consent or create live nonces/capabilities. An
   incomplete saved operation remains outcome-unknown after restart, never runnable.
7. Validate staged files with target-version readers, cross-reference ownership and
   tree ancestry checks before installation. Use private same-directory temporary
   replacements and atomic file replacement with the supported durability pattern;
   report the unavoidable per-file, not whole-dataset, atomicity boundary.
8. Journal each installed file. On interruption, verify hashes and resume remaining
   conversions without duplicating records. Unexpected mixed/changed files refuse
   and remain recoverable from the exact backups; never launch a broad rollback over
   newer user writes. The tool's explicit restore action is also offline and exact-file.

The manifest must support a second dry run/check that proves no convertible legacy
references remain and that every selected owner is converted, deliberately marked
unavailable or explicitly reported blocked. Counts alone are not enough: validate
individual owner/reference mappings and graph preservation.

### Cutover and old-state removal

- Rehearse on synthetic fixtures and a private copied dataset before requesting a
  live window. A live dry run/read is not implied by implementation permission.
- At the approved live window: stop writers, back up, run conversion, validate,
  start the new version, and check representative actual-result/proposal,
  unavailable, moved/forked and standalone history through the application.
- Keep the original review store and backups through that verification. Only after
  an operator accepts the conversion report propose removal of the **exact** old
  review root and recognized pending/orphan data. No age-based reaper, wildcard
  deletion or assumption that an ignored directory is disposable.
- Remove the temporary converter/legacy-only tests in a separate follow-up commit
  once real conversion is verified. Use that event, not a one-week timer. Keep the
  small historical-run instructions and target-format tests. Identify the tested
  tool-containing revision before removing it.
- Unmigrated old cards in the new application keep their card/outcome but render a
  minimal **Legacy review unavailable; offline migration required** placeholder.
  This needs a tiny shape-level fallback, not v1 bundle decoding or file serving.
  Ensure validators do not hide the whole operation/interaction card merely because
  its old review source is unsupported. Old standalone record loading needs the
  same treatment. The fallback must not read old bundle files.

## Implementation checkpoint — P1 foundation

Implemented owners are `plugins/git-workflow/review-{data,reader}.ts` and
`lib/plugins/review-metadata.ts`. They supply immutable native comparisons,
settled-result projection and hidden, detached metadata with exact ancestry
resolution. Navigation projection strips metadata bodies without changing raw
SDK ownership. This is a tested foundation, not an activated v2 card protocol.

Two independent implementation reviewers identified selected file/directory
broadening, ambient ordering, missing-blob availability, context cancellation,
logical-ID conflict and lossless numeric-snapshot defects. All were fixed and
both reviewers closed their findings on a second pass. Their additional copy,
compaction, navigation-topology and fixture-cleanup checks were incorporated.
The final ordering-test nit was also fixed and rerun. Private fault copies
reintroduced those defects and produced exactly 3 reader, 2 metadata and 3 context
lifecycle test failures, with no observed surviving processes. Faults never touched
the implementation checkout.

### Verified evidence and limits

- **Full core/static/plugin:** `nix run .#test -- core --jobs 12` passed all
  **534 files / 4,455 tests / 14 suites**, with zero failures, skips, cancellations
  or observed surviving processes. Requested/effective runner width was **12/12**,
  admitted on x86_64 Linux, 32 CPUs and about 44 GiB available memory. This is not
  browser/terminal or genuine deployment acceptance.
- The full-core input was export
  `e2884d5dfbfc361873098b734a8385b7f1d14ecfc53a5101664385afb6fa38eb`;
  core output is `/nix/store/8jaq3nr38n30jz1kb8g9fpmhvmgzw6j5-brabbler-core-checks`
  (`artifacts/run-RgvKWI/summary.json`). End-to-end command wall time was about
  **279 s**; initial preparation before the runner was about **5.7 s**, and the
  first-to-last test interval was **273.5 s**. These exclude model/review time and
  are not a benchmark against differently prepared runs.
- A subsequent test-only correction moved the opposite-order assertion before
  changing an order file. `nix run .#test -- core --file
  plugins/git-workflow/review-reader.test.mjs` passed **16/16** at export
  `929abd0b869d9c3dff20cfbde20101aaa41bc0925d44998dd9af6e6bb13c860f`
  (about **47 s** command wall time, including updated lint realization). Runtime
  implementation bytes were unchanged; the earlier full-core evidence is not
  relabelled as a new-tip full run.
- SDK fixtures preserve a 2 MiB message and 5,000 selected names through append,
  reopen and copies, keep metadata out of model/display/navigation bodies, and
  distinguish prepared/cancelled versus terminal branches across compaction and
  original-file deletion. These are real SDK custom-entry tests, **not** production
  receipt/card/interaction integration. No chunking is justified by this fixture;
  it does not promise constant memory or arbitrary-size performance.
- Preserve the intentional navigation-body leakage RED and the corrected greens,
  both rounds of implementation reviews, source fingerprints and private fault
  logs outside the repository. No live sessions/review data were read or changed
  during implementation or testing.

### Next bounded slice

P2 host/producer implementation now supplies that save port: detached proposal and
linked settlement records, session initial-flush/fsync barriers, failed-append
publication containment, metadata-only `fork_branch` repair and complete metadata
inside existing standalone owners but outside status/list DTOs. New Git operations
no longer write bundles; original captured objects are checked before preview can
regenerate a missing candidate. Verified postflight supplies result endpoints, not
human summaries or a latest-by-operation join. A saved result still does not prove
terminal receipt persistence. Focused real host/SDK/standalone/native tests pass.
Two independent reviewers closed their findings after real SDK append/barrier faults, clone durability,
nested resource validation and started-wrapper deferred-event repairs. Complete
acceptance remains open.

The [exported schema/API map](../git-operation-review-metadata.md) includes explicit
unavailable legacy comparisons, offline-admitted provenance and lossless once-only
legacy presentation details. P3 must connect those exact owned records to the
retained full viewer/API. P4 owns converter/legacy codec relocation and package
retirement. No live state has been converted, activated or deleted.

## Implementation packages

Unchecked tasks remain proposed/incomplete; checked tasks state their actual scope.
P1 must close concrete discovery questions before P2 hardens the complete protocol.
Keep one repository writer and one receiving candidate; independent reviewers do
not edit it. Record exact acceptance evidence without treating this checklist as
new permission.

### P1 — Freeze the contract and prove the smallest slice

- [x] Inventory actual producers, owners and consumers in the source/test maps above
  and the maintained metadata API guide. Git was the only legacy bundle producer; session
  operation/interaction receipts and existing standalone JSON are reference owners.
  Paused waiting strings are inert. The converter needs the classified bridge and
  narrow export/fileset admission described below; those edits remain P3/P4.
- [x] Add [ADR 0039](../adr/0039-git-backed-operation-reviews.md) and link it from
  the owning guide, explicitly distinguishing the initial foundation from the
  unchanged running archive. The remaining cutover must implement that decision.
- [x] Prove the standalone native comparison reader with private repositories:
  immutable candidate/commit trees, 40-file paging, giant-line/binary streaming,
  local missing-object failure, SHA-256, fallback admission and context closure.
  Full core, including existing native-operation guard tests, passes. No active
  producer/card cutover is claimed by these fixtures.
- [x] Validate target metadata/schema through real host/SDK/native fixtures: first
  flush, save-before-publication, failed-append quarantine, copied review ancestry,
  final clone barrier and complete nested resources pass. Independent re-review
  closed the concrete findings. This does not certify the pending viewer or rollout.
- [ ] Pin down repository replacement/removal and copied-session identity behavior;
  test known surviving worktree fallback and unavailable whole-repository moves.
  Preserve standalone owner-anchor admission and distinct owner/receipt IDs; account
  for missing original legacy binding through explicit offline-admitted provenance.

**Gate:** No patch-archive replacement if it requires a new permanent object store,
weakens path/object ownership, loses complete resource selections or reintroduces
large-patch admission limits. Return for a bounded design decision if these fail.

### P2 — New metadata source, producer and reader

- [x] Implement versioned review metadata and small references in generic host,
  receipt validation/persistence and standalone record owner; prove durable ordering,
  copied/branched access, immutable proposal/result linkage and unsupported fallback.
- [x] Replace Git bundle preparation with structured proposal metadata based on the
  existing private candidate tree; preserve exact-state/check/cancellation behavior.
  Real host fixtures verify first-flush/save barriers, failed-append containment and
  custom-only `fork_branch`; native fixtures refuse a missing original candidate
  before preview can recreate it. A saved result does not certify terminal persistence.
- [x] Capture structured trustworthy result endpoints at settlement from postflight,
  outside bounded human summary strings; distinguish observed/verified/unknown and
  final persistence failure without repeating native effects.
- [ ] Implement local-only Git provider inventory, selected-file/raw-preview,
  streaming download and context reads; exercise literal names, mode changes,
  binary/symlink/gitlink cases and vanished objects with real repositories.
- [x] Implement the simple `same`/`different`/`unknown` rule through the real data
  owner and verify native commit, rebase, no-op and divergent merge composition;
  no permanent content caches or Git refs.

### P3 — Preserve the viewer and retire the running archive code

- [ ] Wire the new source into `ReviewAttachment` / `PluginCard` and operation and
  interaction history. Preserve shared file viewer, lazy reads, preferences,
  navigation, desktop/mobile focus and whole-card fullscreen/action footer.
- [ ] Add actual-result default and conditional original-proposal switch in that same
  viewer; test partial availability, no-op merge, failure/unknown labels and stale
  asynchronous responses on switch/reload/navigation.
- [ ] Replace old download wording/protocol as needed, with explicit source labels
  and complete streamed data; no filesystem write from a review GET.
- [ ] Remove production bundle writer/reader/index/manifest paths, old host ports
  and Git-only expiring context wiring made obsolete by the new source. Retain
  unrelated supplied-patch features and notebook storage.
- [ ] Confirm by import/realized-package checks that only the temporary converter
  contains old review-store handling. Record assertion-by-assertion dispositions
  for retired store-specific tests, with replacements for continuing obligations.

### P4 — Offline converter, rehearsal and application acceptance

- [ ] Implement the isolated converter with dry-run/check/apply/resume/restore modes,
  exact backups and journal; preserve complete session graph and standalone
  acknowledgment history through native synthetic fixtures and fault injection.
- [ ] Exercise old bundle and inline formats, success/proposal-only/unavailable,
  all branches/forks, corrupt orphans, missing owners, duplicate IDs, disk/write
  failures, symlink refusals, interruption and unchanged reruns. Include a prepared
  fork versus successful sibling, terminal copy after parent deletion, unequal
  standalone owner/receipt IDs, native-success/reporting-error shapes, and dry-run
  original-file hash invariance. No live writes.
- [ ] Write portable migration/recovery instructions; rehearse against a separately
  authorized private copy and report classifications without tracking private data.
- [ ] Complete independent source/safety review and the required acceptance matrix
  below on the settled candidate. Preserve failures and exact input identities.

### P5 — Separately authorized operational handoff and retirement

- [ ] Obtain approval for the exact live roots, stopped-writer window and backups;
  execute conversion/check, activate the new version through its normal deployment
  workflow and verify representative historical cards. Otherwise leave this open.
- [ ] Obtain separate bounded approval to remove the old review store after the
  accepted report; verify converted application behavior does not depend on it.
  Backups are recovery material, not implicitly disposable.
- [ ] Record the tested converter revision, remove temporary tooling/tests in a
  separate commit, and verify the historical instructions from a clean historical
  worktree with synthetic data. Reassess required checks for removal inputs.
- [ ] Move lasting contracts into the ADR/focused guides and archive this plan only
  after every remaining operational obligation is completed or explicitly handed
  to a named successor owner.

Local integration follows repository/global rules: rebase onto current local main,
verify the resulting candidate, ordinary unsigned non-FF merge after exact-state
approval. Publication, deployment, worktree cleanup and old-state removal are
separate boundaries. Keep the implementation worktree after this planning handoff.

## Verification and acceptance evidence

### Owner matrix

| Obligation | Primary evidence | Essential bridge / negative |
| --- | --- | --- |
| Schema, outcome/view selection and relation | Production pure owner tests | Missing result cannot become success; object IDs alone cannot imply changed contents. |
| Durable metadata ordering and history | Actual receipt/host + SDK native fixtures | Prepared reference before data fails closed; fork after parent deletion works; off-branch result cannot replace proposal. |
| Git materialization and identity | Real disposable repositories | Stage/index/branch/worktree drift does not change old content; replacement repository denied; deleted feature uses surviving common repo. |
| Safe read boundary | Native provider + authenticated API owner | Forged owner/file/view/path, replacement objects, ext-diff/textconv/fsmonitor markers and partial-clone fetch must not escape to effects/network. |
| Large reviews | Existing large-operation boundaries adapted to new owners | Ask/Allow 1,476,834-byte and 3 MiB patches, 257 files, long message/check output, complete streamed binary/raw downloads without patch files. |
| Viewer state/fetch lifecycle | Mounted real React owner | Proposal/result switch cancels old reads; late content does not overwrite current view; absent proposal leaves actual result usable. |
| Existing user experience | Installed `git-plugin`, `worktrees`, `diff-context` and relevant history/fork bridges | Desktop/mobile per-file drawer/sidebar, 40-file paging, actual-result default, conditional switch, raw view, fullscreen/focus/Escape/footer and download wiring. |
| Offline migration | Real filesystem + target reader fixtures | All-branch graph preservation, copied refs, old-inline unavailable, bad hashes/no-follow, partial journal resume, idempotence and exact restore refusal on newer writes. |
| Standalone history | Default project-operation host/store/API | No session invented; distinct owner/receipt IDs; consent remains evidence; disabled-plugin history via an allowed surviving anchor, denied/missing-anchor refusal; full metadata absent from status/list responses. |
| No permanent patch archive | Import/filesystem/realized-package assertions | New operation cannot create `brabbler/reviews`, embed patch/blob bodies in review metadata or create hidden retention refs. |
| Deployment | Existing genuine Home Manager service check | Restart/persistence/access through the deployed package, never host-service testing. |

Existing targeted test owners include `plugins/git-workflow/{server,runtime,
large-operations,context,review-presentation,cleanup,discard,project-management}.test.mjs`,
`lib/{operation-receipts,rpc-manager-operation-receipts,git-file-context}.test.mjs`,
`lib/plugins/{review-store,project-operations}.test.mjs`,
`components/ReviewAttachment.pagination.test.mjs` and
`components/PluginCard.preview-cleanup.test.mjs`. Store-specific tests belong in
the converter or are explicitly retired; security, streaming, large-input and
copied-history obligations require new production-owner replacements. Confirm
exact API/component coverage through targeted searches, not CodeGraph coverage
claims alone. Add/classify new files in the existing live test inventory.

### Commands and scope

For planning-only changes: source/link/Markdown review, private independent review
reports, `git diff --check` and public-safety inspection. No application suite run
is claimed or required merely for this prose-only plan.

During implementation, run focused existing entry points from the feature root,
for example:

```sh
nix run .#test -- core --file plugins/git-workflow/large-operations.test.mjs
nix run .#test -- core --file lib/plugins/project-operations.test.mjs
nix run .#test -- core --file components/ReviewAttachment.pagination.test.mjs
nix run .#test -- e2e --group git-plugin
nix run .#test -- e2e --group worktrees
nix run .#test -- e2e --group diff-context
```

Use the actual registered migration test owner once added; no fictional command
or non-Nix fallback is accepted as evidence. On a settled implementation, complete
all core/static/plugin, browser/terminal and genuine deployment checks through:

```sh
nix run .#test -- all --workers 4 --jobs 12
# Cacheable equivalent when deliberately chosen:
nix flake check --max-jobs 1 --cores 4 -L
```

Admit resources per Testing; use 4/4 when 12/4 overlap cannot be supported and
record the concrete reason before lowering width. One owner coordinates exports
and dependency work; pause source writers during immutable export. Record exact
candidate/input identity, selection, result, artifact path, requested/effective
widths and end-to-end wall time separately from preparation/test-execution time
where available. Focused passes are not complete acceptance. Do not run production
builds in a checkout or test against the installed service. Plan-only commits and
later evidence-only edits use proportional checks without relabelling older runs.

## Risks, stop conditions and recovery

| Risk | Required handling |
| --- | --- |
| Missing or collected objects | Explicit per-view unavailable state; accepted product tradeoff, no automatic fetch/archive. |
| Current staging differs from proposal | Keep immutable candidate tree and existing revalidation; never use live staged content as saved review. |
| Metadata size reintroduces card caps | Separate once-only metadata from bounded stage cards; P1 large-selection gate before schema rollout. |
| Repository moved/replaced or wrong-project session | Fail unavailable/denied; independently authorize surviving known repo, no current-cwd substitution. |
| Old outcome exists only in prose or cannot be correlated | Preserve outcome label and proposal; actual-result unavailable rather than guessing. |
| Offline conversion interrupted or inputs changed | Journal exact installed hashes, stop on changed files, resume/check or explicitly restore exact backups; no whole-tree overwrite. |
| Legacy reference prevents card validation | Minimal unsupported-source display fallback keeps card/outcome; no old bundle-reader import. |
| Migration/package fixtures leak into runtime | Explicit Nix/export/packed inventory and import checks before cutover and after tool removal. |
| New display/storage failure after native success | Preserve completed effect and limited reporting truthfully; never retry the Git mutation. |
| Removal erases recovery path too early | Tool removal after verified live conversion; old-state deletion and backup deletion are separately authorized. |

Before cutover, rollback is simply the unchanged application and state. After
conversion, old binaries may not understand new review metadata. Roll back the
binary **and exact backed-up state together**, only while stopped and after checking
that no newer user writes would be overwritten. Once new sessions have been written,
prefer a forward fix or a separately designed merge of state; do not restore an
old snapshot over them. After legacy-store deletion, recovery requires retained
backups; after tool removal, use its recorded historical revision. No step promises
a whole-dataset atomic transaction or that Git objects are retained forever.

## Open implementation questions (finite discovery work)

P1 owns these, rather than treating them as unresolved product questions:

1. Confirm metadata-part sizing and fork-copy behavior against the pinned SDK,
   including oversized exact messages/resource lists and session rewrite costs.
2. Confirm every old reference owner and available structured postflight fields.
   Preserve inert paused strings unchanged. Verify occurrence-scoped result recovery,
   explicit unavailable legacy bindings and unequal standalone owner/receipt IDs,
   without inventing a production reader or cross-branch/global result join.
3. Select the smallest reusable native inventory/stream helpers and explicit rename
   policy without importing Explorer's branch/reachability/output limits.
4. Confirm converter distribution/test fileset and the operational cutover order
   for the installed package. Actual live roots and permissions stay out of this
   public plan and require separate authorization.

No new permanent storage, history pins, online migration or broader Git-policy
feature may be introduced to close these questions without returning to the user.

## Independent plan review

Two independent reviewers inspected the draft and relevant source without changing
repository or live state. The architecture review found no architectural blocker;
the migration review identified two schema/converter gate issues. This revision
adopts their concrete remedies:

- Separate originally captured repository facts from offline-admitted legacy
  bindings; preserve standalone owner-anchor admission rather than bypass it.
- Scope migrated results to the exact owner, receipt occurrence and branch; keep
  standalone owner/request IDs distinct from Git operation/review IDs.
- Use byte-preserving read-only discovery, a precise graph-preservation oracle and
  a classified migration test bridge with narrowly admitted source files.
- Preserve inert paused-card strings, make raw-patch regeneration diagnostic only,
  and keep full standalone metadata out of polling/list responses.
- Test missing live candidate objects before regeneration, rename/path reuse,
  descriptive gitlinks and partially populated/untrusted postflight observations.

No new storage service, compatibility runtime, UI dashboard or live migration
permission was added. Both reviewers approved the revised plan on a second pass,
with no remaining material plan blockers in their scopes. Final checks cover local
Markdown target existence, whitespace and public-safety inspection; links were not
browser-tested. Only the executive summary and planning-status text were polished
after that approval. Implementation and operational checks remain unchecked.

## Completion checklist

### Planning handoff

- [x] Dedicated feature branch/worktree created from current local main; worktree
  CodeGraph initialized before research.
- [x] High-level product direction and best-effort/offline migration decision
  recorded in a public-safe detailed plan with a plain-language executive summary.
- [x] Independent architecture/safety and migration/simplicity reviewers challenged
  the draft; concrete findings were adopted and both approved the second revision.
- [x] Revised-plan re-review and local link-target/whitespace/public-safety checks
  passed; retain the branch/worktree for the planning handoff. These are source
  checks, not browser or application acceptance.

### Implementation / operational completion (not claimed by this planning task)

- [ ] New ADR and maintained guides accurately describe object-backed history,
  unavailable states, actual-result/proposal UI and backup/retention expectations.
- [ ] New session/standalone records, readers and existing file viewer work without
  permanent patch content; exact-state and authorization protections remain intact.
- [ ] Retired production store paths have no remaining runtime dependencies; all
  continuing test obligations have explicit passing replacements.
- [ ] Converter passes native synthetic faults/rehearsal; complete application
  acceptance and independent source review pass on the resulting candidate.
- [ ] Separately authorized real conversion/activation and representative history
  verification are accepted, or operational handoff remains explicitly open.
- [ ] Old-state cleanup is separately approved; converter removed after verification,
  historical invocation is reproducible and backup disposition remains explicit.
- [ ] Local integration and any resource cleanup follow their separate exact-state
  permissions. No remote publication is inferred.
