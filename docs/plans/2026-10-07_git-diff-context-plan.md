# Full-file context and Git diff review UX

## Goal

Reveal nearby unchanged lines, an entire gap, or the complete matching file in split and unified Git diffs. Add change navigation, clean Before/After reading, literal search and line jump, wrapping preferences, retained local reading state, sticky file controls and a wider reader. The user authorized detailed planning and implementation, dedicated worktree creation and CodeGraph initialization. Local integration, publication and cleanup require separate approval.

Worktree: `/home/robert/projects/3rdparty/pi-web-worktrees/git-diff-context`; branch `feat/git-diff-context`; local starting point `rst-main` at `9c0f92b895cd708db73b20bb6a2a1e214458e64f`.

Implementation and application acceptance are complete. Candidate commit/rebase preparation remains below; the installed service is unchanged.

## Context

At planning time, `CommittedPatchDiff` accepted only a partial patch, fixed wrapping and metadata separators, falling back to raw above 2,500 patch lines. `GitPatchStack` already deferred off-screen files and limited patch requests to three. Its Expand all action opened file sections, not unchanged context. Git Explorer already guarded checkout roots, captured local tips, reachability and changed-path membership; Files and approval contexts needed additional snapshot authority.

The pinned `@pierre/diffs` 1.5.1 supports hydration, gap expansion and virtualization without an upgrade. A 100-line fixture verifies 7 split / 8 unified patch rows becoming 100 / 101 full-context rows, retaining the original change hunks.

## Plan Relationship

Extends `2026-09-27_git-explorer-split-diff-plan.md` and `2026-09-27_git-panel-ux-plan.md`. Their original patch-only/no-full-file scope is deliberately broadened, not retroactively edited. `2026-10-06_persistent-interaction-cards-plan.md` continues to own receipt semantics. This feature does not change execution authority, approval scope or history projection.

## Architecture and Resolved Spikes

- `lib/git-file-context.ts` reads literal regular-file tree entries and bounded blobs, without replacement objects, lazy fetching, protocols, filters or external diffs. Limits are **1 MiB per side and 50,000 combined logical lines**. Invalid UTF-8, NUL/binary content, symlinks, gitlinks, unavailable objects and oversized files fail honestly. Empty and absent sides differ; BOM/newline bytes are preserved.
- Explorer's strict `op=context` uses the same checkout/tip/reachability/path guards as patch retrieval, reads first-parent versus selected commit objects and revalidates the anchor afterward.
- Files patches carry a revision binding captured HEAD, file contents and filesystem identity. Context rechecks it before and after immutable reads. Stale revisions offer **Refresh diff**, never substitute newer data. Its in-memory registry has a one-hour TTL and 512-entry limit.
- Plugin-generic cards carry only an optional UUID `patchContext`. GET `/api/plugins/bundled/[id]/patch-context` accepts that handle and a numeric file ID, not arbitrary paths/revisions or a preview operation. The Git plugin captures HEAD/candidate-index-tree or merge-base/feature IDs and changed-file mappings. Its registry stores identifiers, not contents: **one hour, 64 handles, 256 files/handle**, with physical common-Git-directory identity checks.
- **Selected lifetime/fallback:** receipts retain the original opaque handle, not a durable file-content bundle. Legacy, expired, evicted, restarted or unavailable snapshots remain patch-only. This deliberately rejects the investigated durable-content alternative to avoid enlarging private receipt history or adding a resource store. The patch and decision remain exact and independent of context availability.
- `lib/git-diff-review.ts` retains stable parsed metadata and verifies supplied hunks **and every omitted unchanged range** before hydration, without recomputing changes. Complete add/delete patches can supply their own bounded available version.
- The public Pierre React `CodeView` owns a bounded virtualized scroll container. `onPostRender` and its public rendered-item/scroll/expansion methods provide keyboard-accessible gap controls, navigation and logical-line anchoring; no protected renderer map is inspected. Application-owned expansion/reading/context caches survive renderer unmount.
- Full context is per-file and lazy. **Expand all files** never fetches every complete file. Stack patch and context queues are separately capped at three reads. Only validated split/unified/raw and wrap preferences persist in browser storage; contents and context choices do not.

## Non-Goals

No editing/staging/checkout controls, arbitrary revision comparisons, remote reads, library upgrade, whitespace suppression, changed approval scope, persistent content/expansion drafts, historical backfill, production build, installed-service activation/restart or separate tool-output diff changes.

## Risks and Recovery

Large files remain bounded and virtualized; accepted browser fixtures contain 5,000 lines and distant changes, not an extrapolated performance claim for every possible file. Moving refs/files or missing candidate objects refuse new context while preserving the patch. Incompatible transformations cannot silently relabel hidden changes as unchanged context. External filesystem/Git writers are not coordinated beyond identity and before/after checks. Reverting the feature needs no session migration and preserves original patches/receipts. Browser acceptance here is Linux/Chromium; native Windows browser behavior was not exercised.

## Plan

- [x] Close virtualization, expansion/scroll retention and snapshot-lifetime spikes; implement public `CodeView` APIs and the explicit expiring-handle fallback above.
- [x] Add bounded immutable tree/blob readers; test literal paths, root/add/delete/empty sides, size, UTF-8/BOM, binary, mode and missing-object cases.
- [x] Add Explorer context admission; test stale branches, forbidden fields/paths, reachability and dirty-checkout isolation.
- [x] Add working revisions and Files integration; test HEAD/file changes, renames, absence, no-follow races, limits, TTL and quota.
- [x] Add generic optional context transport and plugin snapshots; test opaque file admission, immutable comparisons, expiry/quota, legacy receipts and unchanged decisions.
- [x] Add shared review models/preferences; test patch-preserving hydration, omitted-range agreement, comparison-local state and safe storage.
- [x] Implement whole-file/incremental/whole-gap context, change navigation, Before/After, search/line jump and wrapping; exercise actual split/unified/clean-file browser rendering.
- [x] Retain per-file state; label file-section actions clearly, add sticky controls and wider reading; test collapse, anchors, desktop/mobile and Escape/focus without answering approvals.
- [x] Extend Explorer/Files/plugin/receipt fixtures with 5,000-line multi-hunk comparisons; verify laziness, bounded DOM, failure/retry, stale selection isolation and immutable historical context.
- [x] Hand maintained behavior to `docs/worktrees.md`, `docs/git-workflow-plugin.md`, `AGENTS.md` and browser-test notes.
- [x] Complete full offline/core/static/plugin/browser acceptance without a production build; evidence follows.
- [ ] Commit the implementation, rebase on current local `rst-main`, verify and present exact candidate/target IDs for separately approved unsigned non-FF integration. Retain feature resources; no publication or cleanup is inferred.

## Verification Evidence

Tests used disposable repositories; core/browser runtime checks also used private HOME/agent storage, without live credentials/model calls. Browser tests used their own loopback Turbopack server and Chromium at 1280px / 390px widths, never the installed service on 30141.

| Command / scope | Result |
| --- | --- |
| `nix develop -c node nix/test-offline.mjs --jobs 8` | 247 files, 1,599 tests passed; exporter contracts, typegen, typecheck and lint passed |
| `npm test` in the Nix shell with private HOME/XDG/agent and `PI_OFFLINE=1` | 1,605 tests passed |
| `node_modules/.bin/tsc --noEmit --incremental false` | Passed |
| `npm run lint` | Passed, no warnings |
| `nix develop -c sh -c 'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test "plugins/**/*.test.mjs"'` | 35 tests passed |
| `E2E_DIFF_CONTEXT_ONLY=1 nix develop -c npm run test:e2e` | Explorer/Files desktop and mobile passed |
| `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 nix develop -c npm run test:e2e` | All approval layouts, snapshots, receipts/expiry, wide Escape and lifecycle at desktop/mobile passed |
| `nix develop -c npm run test:e2e` | Full browser acceptance passed |
| Bounded read-only implementation review | No concrete correctness/security/lifecycle defect reported |

Initial no-follow open races were normalized to refresh-required conflicts. A boundary fixture was corrected to count logical lines rather than trailing EOF. An owned completed-test lock blocked one full-browser startup; its dead PID/unbound port were checked and its metadata preserved at `/tmp/pi-web-stale-owned-test-lock.3xB2gs/lock` before successful rerun. No competing or installed server was stopped. Terminal acceptance is not applicable: terminal integration was not changed.

## Completion Checklist

- [x] Both layouts expose complete matching bounded text and return to diff context without changing the raw patch.
- [x] Gap/context/navigation/clean-file/search/wrap/wide controls and retained state work at tested desktop/mobile widths.
- [x] Reads are lazy, authorized, matching and bounded; failed/expired/stale context never changes approval scope.
- [x] Root/first-parent/dirty-worktree/stale-branch, binary/raw and read-only receipt guarantees remain covered.
- [x] Maintained guides describe shipped behavior and required application acceptance passes.
- [ ] Exact feature candidate is committed and prepared for separate local integration approval.
