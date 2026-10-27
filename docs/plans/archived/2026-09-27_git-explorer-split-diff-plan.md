# Side-by-side committed patches in Git Explorer

## Closure — completed historical milestone (2026-10-27)

Integrated lineage `623197a` is on audited main. Later complete acceptance covers
the surviving committed-diff browser/native flow. Pierre and authorized full
context supersede the original renderer/API restriction; current behavior belongs
to `docs/worktrees.md`. See the [closure evidence](../README.md#closure-evidence).
Original unchecked boxes and unchanged-retry observations below are historical;
this closure does not assert a fresh full run or approval provenance at the old tip.

## Goal

Replace the raw patch in Git Explorer commit tabs with a legible old/new side-by-side view. Keep unified text available, and retain the current committed-object API and its bounds.

## Plan Relationship

`2026-09-27_worktree-git-explorer-plan.md` owns the already-integrated explorer and its read-only data boundaries. This enhancement changes only the presentation of its file patches; it does not implement cleanup or session-bound merge review.

## Tech Stack

- Reuse the existing GET `op=patch` response; no full-file fetch or new server route. Pi Web already has `lib/patch.ts` plus a basic private split renderer in `MessageView.tsx` for tool output, but extracting it does not provide a file-review UI, hunk labels or a unified/split toggle.
- Use MIT-licensed `react-diff-view@3.3.3`: it parses Git unified patches directly and renders split/unified hunks, with line numbers and CSS variable theming. `@git-diff-view/react` is another polished MIT option but its primary API expects reconstructed old/new file contents; that needlessly expands the API and client payload for this task. `react-diff-viewer-continued` also expects old/new full text.

## Non-Goals

No patch mutations, arbitrary revision comparisons, full-file content fetching, automatic syntax highlighting, or changes to other diff surfaces. Binary, metadata-only and oversized patches retain their existing summary/error behavior.

## Plan

- [x] Install the pinned, peer-compatible package in the feature checkout; inspect exports and verify it parses root, binary/metadata, ordinary and first-parent merge patches without full-file contents. Evidence: npm registry metadata, `components/CommittedPatchDiff.test.mjs`, focused E2E merge/root/ordinary and `tsc --noEmit`.
- [x] Add a theme-aware side-by-side renderer in `GitCommitViewer.tsx` with old/new labels, line numbers, hunk context, unified/raw fallback and horizontal scrolling at narrow widths. Evidence: focused component tests and focused browser viewport checks.
- [x] Extend Git Explorer E2E for old/new columns, split/unified switching and no-session/mobile behavior; test binary and metadata fallback in `CommittedPatchDiff.test.mjs`; update `docs/worktrees.md`. Evidence: focused browser run and full browser retry passed; binary/metadata and >2,500-line raw fallback unit tests passed.
- [ ] Verify the exact committed feature candidate with `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e`; never run a production build. Pre-commit checks passed (1,530 tests, typecheck, lint, full E2E retry); the first full E2E timed out in an unrelated session-scroll-restoration check and passed unchanged on retry.

## Completion Checklist

- [ ] A selected committed text file displays aligned two-column changes, while existing root/merge and stale-checkout safeguards still work.
- [x] Binary/metadata-only patches remain truthful and readable; narrow screens can scroll without clipping the panel. Unit tests cover fallback, browser E2E checks scroll width at 390 px.
- [ ] Feature commit and separate exact-state local integration approval have been handled; publication and cleanup remain separate.
