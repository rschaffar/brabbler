# Rename-aware committed Git reviews

## Goal

Show a detected move as one **Renamed: old path → new path** entry, with only its
actual content edits, in Git Explorer (including notebook commit views) and Git
operation approvals/receipts. Authored endpoint-tree comparisons are deferred.
Pure renames remain visible even without hunks. Reuse native Git and the existing
diff renderer rather than inventing a rename detector.

**Status / authority:** Implementation authorized by the user after independent
plan review; work continues in the same feature worktree. Native pairing proof
and implementation are complete; focused checks pass and full acceptance is pending. Verification is required before exact-state local integration;
deployment, publication and cleanup remain separately gated.

## Context

Source inspected at local `main` `14d60757535e0ed78ff3753fda1372b0e4c47bbb`:

- `lib/git-explorer.ts` disables renames in commit/comparison inventories and
  patches. Its name-status parser accepts one-path records, not scored two-path
  rename records; `ExplorerFile` carries no original path.
- `plugins/git-workflow/review-reader.ts` independently represents renames as
  delete/add. Its raw inventory, selected patches and file-version digest use
  that policy. Existing path-reuse tests protect selected-file isolation.
- `lib/git-patch-display.ts`, `GitPatchStack` and `CommittedPatchDiff` already
  understand rename metadata. `readGitFileContext` already accepts `previousPath`.
- Saved reviews capture Git trees/endpoints, not generated file IDs or patches.
  `review-provider.ts` uses the recorded settlement relation, not a newly computed
  relation during historical reads. Navigation file IDs are transient.

## Plan Relationship

This plan owns committed-review rename presentation and paired-path reads only.
The active [Git-backed reviews plan](2026-10-31_git-backed-operation-reviews-plan.md) retains
its converter, operational migration and old-state disposition work; this plan
neither claims those complete nor changes their implementation. The
[Explorer fullscreen plan](2026-10-13_git-explorer-fullscreen-plan.md) retains its
layout/history queue.

Preserve [ADR 0040](../adr/0040-git-backed-operation-reviews.md): immutable captured
content, on-demand reads, independent admission, size-independent approval and
path/version/mode equality. This follow-up replaces the current delete/add
**display** choice, not that equality definition. Update the maintained
[worktree](../worktrees.md), [feature](../feature-internals.md) and
[review metadata](../git-operation-review-metadata.md) guides with delivered behavior.

## Design and limits

- Represent a rename using normalized status `R`, destination `path` and optional
  `previousPath` in Explorer and generated review-page entries. Parse/validate Git's
  similarity score, but no new similarity control or percentage UI is needed.
- Use one explicit, small native-Git presentation policy: rename-only detection
  at 50% similarity, empty-source renames enabled and an explicit 1,000-candidate
  inexact-detection limit. Reset inherited rename/copy behavior before enabling
  detection; do not enable copies or rewrite breaking. This bounds expensive
  matching independently of ambient `diff.renames` / `diff.renameLimit`. Above the
  limit Git may retain unmatched moves as add/delete; exact matches can still pair.
  Document this limit rather than claiming perfect move inference.
- Keep format-specific parsers at their current owners (NUL name-status versus
  streamed raw records). Share only the small argument/path-selection helpers
  actually needed; no new Git service or general parser framework.
- The complete commit/review inventory chooses a pair. Browser requests still
  select an existing destination path (commit view) or numeric inventory ID
  (operation review), never submit an arbitrary original path. Server lookup
  derives and authorizes both immutable paths. Context reads old tree/original
  path and new tree/destination. Old-side feedback selections cite the original
  path; new-side selections cite the destination.
- For non-nested pairs, use the inventory-derived original and destination literal
  pathspecs, excluding descendants of each. Without copies or rewrite breaking,
  these select one deleted source and one added destination; verify global pairing,
  status and versions. Use a command-local `--no-literal-pathspecs` override for
  explicit magic, not a global weakening of literal-path protection.
- **Known P1 feasibility gate:** `item → item/child` and the reverse defeat blanket
  descendant exclusions; positive pathspecs cannot override an exclusion. Prove a
  small exact selection for both directions, including unrelated changed siblings,
  before UI work. A narrow exception is acceptable only when the full inventory's
  old/new endpoints prove no unrelated change can enter. If a simple safe strategy
  is not established, stop for a bounded design decision. Never silently enable
  destination-only detection, drop isolation, synthesize patches, scan the entire
  patch stream or introduce a persistent cache to get past this gate.
- Preserve authored comparison semantics: leave `explorerCompare`,
  `explorerCompareFile` and all `compare` / `compare-patch` / `compare-context`
  behavior unchanged. Inventory and patch remain no-renames/single-authored-path;
  context reads that same path in both trees. Both old-path deletion and new-path
  addition evidence remain valid. No path alias, protocol mode, notebook rewrite
  or fingerprint migration. Notebook commit stops inherit `GitCommitViewer`
  presentation without changing their authored commit identity.
- Keep `changeDigest` / proposal-result equality on the existing canonical
  **no-renames path/version/mode** inventory, explicitly separate from presentation.
  Pairing is a heuristic and must not change operation truth or stored relations.
- Existing supported saved metadata remains readable without format changes,
  rewriting records or migration. Reopened reviews may show rename grouping for
  the same captured objects; saved outcomes, relations, proposal/result labels,
  authorization and unavailable behavior remain unchanged. Legacy unsupported
  cards stay unsupported. Do not change the offline converter for display alone.
- Preserve first-parent/root semantics, full comparison ancestry guards, physical
  repository binding, no fetch/external helpers/textconv, regular-text context
  restrictions, existing limits and joined cancellation/stream ownership. Keep
  optional Git semantics in the plugin, not generic chat.

## Non-Goals

- Working-tree Files/porcelain behavior, its pure-rename limitation, or legacy chat
  patch rendering; these are separate from committed review materialization.
- Copy detection, directory-rename synthesis, history following, rename controls,
  dependency upgrades, a new renderer, persistent content or retention refs.
- Rename grouping for explicit endpoint-tree comparisons, or changing Git operation
  arguments/permissions, approval scope, receipt outcomes, relation semantics,
  notebook authored content or saved reviewer answers.
- Migrating live state, activating a service, publishing or cleaning old resources.

## Plan

### P1 — Prove the pairing contract, then deliver Explorer

- [x] Add native fixtures to `lib/git-explorer.test.mjs` for pure and edited renames;
  verify one `R` entry, both paths, metadata-only visibility and actual edit hunks.
- [x] Prove selected/full consistency early using real Git: ambiguous equal-content
  candidates, original-path reuse, rename chains, and both `item → item/child` and
  reverse renames, with and without unrelated changed siblings. Extend the existing
  review-reader file/directory-transition owner. Compare normalized old/new paths,
  modes/OIDs and selected patch blocks. Stop if a small safe nested-path strategy
  is not established; do not proceed on sibling-path fixtures alone.
- [x] Add the minimal presentation policy/helpers and strict scored two-path
  parsing; extend `ExplorerFile`, `commitFiles`, `explorerPatch` and
  `explorerFileContext`. Verify immutable before/after contents, root/first-parent
  behavior and refusal of unknown paths. Leave explicit comparison readers unchanged.
- [x] Pass original-path metadata through `GitCommitViewer` into the existing
  `GitPatchStack`; add the `Renamed` label. Notebook commit views inherit this
  composition; do not restructure `CompareEvidence`. Verify old → new names and
  pure/edited rendering using existing mounted component owners.
- [x] Make `CommittedPatchDiff` feedback selections side-aware (`prevName` on the
  old side, `name` on the new side); verify both with its mounted selection owner.
  Preserve existing saved anchors without rewriting/rebasing reviewer records.

### P2 — Apply the same presentation to operation reviews

- [x] Split canonical equality enumeration from presentation enumeration in
  `plugins/git-workflow/review-reader.ts`; parse scored raw rename records and keep
  old/new modes and OIDs. Extend generated `GitReviewFile` / `ReviewPage` with
  `previousPath`; validate complete framing and object availability as before.
- [x] Update selected preview/download/context to use the inventory-derived pair,
  preserving exact paired-path isolation using the strategy established by P1,
  validation before response headers, binary/full-index download fidelity and child/iterator closure. Verify selected
  bytes against the corresponding complete-download file block.
- [x] Update `ReviewAttachment` navigation and labels to show old → new and Renamed;
  reuse the existing renderer for pure, edited and binary renames. Exercise the
  session and standalone provider bridges without changing mutation authority.
- [x] Verify unchanged metadata decoding and stored outcomes/relations using existing
  `review-data`, provider and attachment tests. Add a saved-review reopening case
  with a deliberately disagreeing recorded relation to prove reads do not recompute
  it. Add relation counterexamples: the same path/version/mode changes remain equal
  despite different display pairing; a changed version/mode remains different.

### P3 — Close focused regressions and accept the settled candidate

- [x] Extend existing native/parser owners for empty files, binary moves, mode changes,
  tab/newline/Unicode/pathspec-looking names, malformed/truncated records, explicit
  detection-limit behavior and hostile ambient rename/copy configuration. Retain
  meaningful path-reuse/symlink/gitlink checks rather than replacing them with only
  happy-path renames. Re-review any changed test effects/classification.
- [x] Extend `GuidedReviewReader.diff`, notebook-material/store and existing route
  owners with unchanged old-path deletion/new-path addition comparisons and saved
  answer fingerprints; verify notebook commit identity/currentness is unchanged.
  Keep authored comparison readers and saved reviewer bytes untouched.
- [x] Add thin installed-browser connections to the existing `diff-context` and
  `git-plugin` groups: one renamed entry, correct names, real edits/pure-rename state,
  immutable context and historical selected download. Keep edge matrices in native
  and mounted tests; do not introduce new groups or repeat them all in Chromium.
- [x] Update maintained guides with presentation policy, limit and saved-review
  behavior. Independently review the settled implementation for paired-path
  authorization, selected/full consistency and accidental scope growth.
- [ ] Run focused checks while editing, then complete the repository's acceptance
  matrix once source/review fixes settle. Record exact candidate/source identity,
  commands, results, artifact paths, requested/effective widths and end-to-end versus
  preparation/execution time. Do not use the host service or an in-checkout build.

### Verification entry points (after greenlight)

Run focused files individually with `nix run .#test -- core --file <path>`, using:

- `lib/git-explorer.test.mjs`, `lib/git-file-context.test.mjs`,
  `lib/git-patch-display.test.mjs`, `lib/git-diff-review.test.mjs`;
- `plugins/git-workflow/review-reader.test.mjs`,
  `plugins/git-workflow/review-data.test.mjs`, `lib/plugins/review-provider.test.mjs`;
- `components/GitPatchStack.test.mjs`, `components/OperationReviewAttachment.test.mjs`,
  `components/ReviewAttachment.pagination.test.mjs`, `components/CommittedPatchDiff.test.mjs`,
  `components/GuidedReviewReader.diff.test.mjs`, `lib/notebook-review-store.test.mjs`
  and affected existing route owners identified by the final diff;
- `lib/plugins/git-operation-review-migration.test.mjs` for the offline tool's
  frozen transitive helper-identity and private source-copy checks.

Focused browser: `nix run .#test -- e2e --group diff-context` and
`nix run .#test -- e2e --group git-plugin`; use `markdown` if the guided reader changes.
Full acceptance: `nix run .#test -- all --workers 4 --jobs 12`, subject to resource
admission in [Testing](../testing.md#coverage-and-resource-admission); use four/four
or a smaller supported budget only with the concrete resource reason recorded.
This includes static/core/plugin, all browser/terminal groups and the genuine
Home Manager deployment VM. Focused success is not full acceptance.

## Risks and stop conditions

- Rename detection is inferred, not committed metadata. Ambiguous matches and the
  bounded inexact search must remain honest and internally consistent.
- Stop if selected patches include another change, lose binary/mode metadata or
  cannot be matched to the global pair; do not suppress the mismatch.
- Stop if compatibility requires persisted-ID/schema migration or a change to
  approval/equality semantics. Bring that evidence back instead of expanding scope.
- Missing Git objects remain unavailable, never a working-file fallback. Existing
  read limits/cancellation are not relaxed to make new tests pass.

## Independent plan review disposition

Two independent read-only source reviews assessed native pairing/safety and
compatibility/scope. All concrete findings were accepted:

- Make nested endpoint selection a named early gate; do not claim that two literal
  paths plus blanket exclusions solve it. Keep ordinary two-path reads.
- Defer authored endpoint-tree comparison grouping to preserve existing material
  availability, fingerprints and saved answers without aliases or new modes.
- Correct old-side selection provenance and retain the current guided-view
  composition rather than routing its single-file comparison through a stack.
- Keep canonical equality, recorded relation and saved review metadata unchanged;
  prove reopening with a recorded relation that differs from display inference.

Both reviewers confirmed the amended plan addresses their substantive findings.
No new framework, schema migration, persistent cache, whole-patch filtering engine
or broader UI restructuring is justified. At planning handoff, the nested-path
proof was proposed implementation work, not a verified solution. Plan reviewers
ran no checks or builds.

### Implementation disposition

Native fixtures closed the selected-read feasibility gate: nested pairs use the
complete inventory to exclude unrelated descendants. Other endpoint prefixes use
escaped descendant globs; a bare trailing-slash exclusion also hides a selected
gitlink. Nested download admission runs the exact command with `--no-patch` before
headers to detect native argv exhaustion without truncation or a new fixed
application limit. No whole-patch scanner or patch synthesis was needed.

Independent implementation review found two browser-fixture issues (fullscreen
tab order and mobile navigation), both corrected. Added binary mounted, strict
raw-framing, gitlink/symlink, detection-limit, preheader-failure and notebook
saved-answer regressions cover its requested gaps. The corrected gitlink selection
passes native tests. A real oversized immutable tree proves native `E2BIG` refusal
before download headers while overview and the whole download remain available;
no mocked subprocess or new operation-size ceiling is used. The mounted notebook
commit-stop bridge and both installed-browser groups pass (including mobile).
Focused checks cover the original thirteen named core owners across corrected runs.
Full acceptance identified one additional compatibility dependency: the offline
converter's explicit frozen helper closure must include `lib/git-rename.ts`, now
imported by its existing reader. Only that list is extended; conversion policy,
state, formats and the separate migration workstream remain unchanged. Its existing
closure/private-copy checks are the focused regression owner. Full acceptance
remains required; source review alone is not execution evidence.

## Rollback / Recovery

Revert the presentation implementation commits to restore delete/add display.
No persistent records, converter output or live service state is rewritten by this
change. Keep any failed-run evidence; worktree removal, deployment and publication
remain separately gated operations.

## Completion Checklist

### Planning handoff

- [x] Isolated feature worktree created from the stated local main; CodeGraph initialized.
- [x] Existing source, active-plan overlap, ADRs and owning verification guides inspected.
- [x] Two independent plan reviews assessed; concrete findings and excluded alternatives recorded.
- [x] Planning-only handoff prepared; no application code or tests changed.
- [x] User greenlights implementation in this worktree.

### Implementation (verification in progress)

- [x] Explorer and operation review inventories, patches, contexts and labels agree
  on pure/edited renames, with paired-path isolation and regression evidence;
  authored endpoint-tree comparison semantics remain unchanged.
- [x] Existing saved metadata/outcomes/relations and operation safeguards remain intact.
- [ ] Maintained guides, independent implementation review and complete Nix acceptance pass.
- [ ] Exact-state local integration is separately approved; no deployment, publication
  or feature-resource cleanup is implied by this plan's completion.
