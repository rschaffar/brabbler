# Session worktree filtering and bulk move

## Goal

Make existing session relocation easy to use across a project: independently filter
by worktree (including missing directories), recover missing-worktree histories to
the verified main checkout, and move selected sessions with one destination picker.

User approved implementation after choosing: independent filter; include archived
history in recovery; recover missing roots/subtrees with descendants. The abandoned
project-relocation worktree/branches were deleted separately. This is not that epic.
Start: local `rst-main` `6bc2c3f42b50ce3771af297a875cb14c4656de0e` in linked worktree
`session-worktree-filter-bulk-move`, branch `feat/session-worktree-filter-bulk-move`.
No live-data move, service deployment or publication is authorized.

## Plan Relationship

`docs/worktrees.md` and `docs/session-internals.md` own maintained behavior. The older
session destination-picker plan owns the existing individual move, which stays
compatible. This work adds orchestration around that mover, not checkout movement,
project preference/trust migration or a transactional relocation platform.

## Architecture

- Session worktree inventory combines registered checkouts and project session paths;
  absent, present and unavailable remain distinct. Missing paths never become cwd grants.
- Sidebar session filtering is independent from New/Files/Terminal cwd selection.
  Filter scope applies to search and resets bulk selection. Preserve family context
  without losing child-only matches or silently expanding selection.
- Recovery includes archived history regardless of list filters. Verify the primary
  checkout; don't infer it from the first surviving filtered worktree. Unknown ownership
  or main blocks recovery, while ordinary manual Move stays available.
- One reusable bulk dialog previews exact root/subtree expansion, then executes using
  the existing family mover. Deduplicate overlapping roots; independent forks stay put
  unless selected. Revalidate missing eligibility and approved family membership before
  effects. A serialized preview is not authority to invent session membership.
- Partial success is explicit; no automatic stopping, retries or batch rollback promise.
  Refresh even after lost responses before retry. Preserve archive state and session IDs.

## Plan

- [ ] Add bounded session-worktree inventory, verified main and guarded bulk preview/
  execute endpoints; cover missing-vs-unavailable, archived/mixed families, overlap,
  destination and membership changes, partial failures and existing move compatibility.
- [ ] Add independent Sidebar filter with missing-directory labels, matching search and
  selection scope; reuse picker in a bulk Move/recovery dialog with exact expanded counts.
- [ ] Cover genuine desktop/mobile filtering, stale history and both move workflows in
  existing browser fixtures; preserve scenario inventory/deadlines and current actions.
- [ ] Complete independent review, focused checks, then full Nix core/browser/terminal/
  deployment acceptance on settled inputs. Record runtime and retained failure evidence.
- [ ] Update maintained guides; create coherent unsigned commits and prepare exact-state
  integration into current local rst-main via non-FF approval. Manual tests may follow
  integration; host deployment and actual session moves remain separate operations.

## Rollback / Recovery

Reuse individual family move staging/rollback. Bulk batches are deliberately partial;
report moved/skipped/failed results, refresh actual history and retain failed selection.
Do not automatically retry ambiguous network outcomes or reinterpret them as unchanged.
Do not add persistent operation journals or credential/settings writes.

## Focused evidence (before current-main reconciliation)

- Parent owns all repository writes, exports and checks. Independent source-only backend
  and UI reviews found no remaining blockers after corrections. Native admission fences
  refuse newly running/queued or reopened idle wrappers; no automatic stopping was added.
- `nix run --offline --no-write-lock-file .#test -- core --offline --jobs 2` with the eight
  selected move/filter/sidebar files passed **52 tests / 8 files** in **41 seconds**
  command wall time (including realization), before the implementation commit/rebase.
  Selection, source identity and results: `/tmp/pi-web-test-core.Q6e4Qo/run.json`;
  command/timing: `/tmp/pi-web-session-worktrees-final-focused.yZModrq1/`.
- Packaged `e2e --offline --group move --workers 1` passed desktop and mobile, including
  native-dialog Browse, four-session archive-inclusive recovery and two-session bulk
  movement, in **105 seconds** command wall time (including isolated package build).
  Evidence: `/tmp/pi-web-test-browser.2vjTtI/run.json`,
  `/tmp/pi-web-session-worktrees-browser-modal.6kgL7I3j/`. A later search-scope assertion
  and skipped-count display refinement await final acceptance; this is not a new-tip run.
- Retained failures exposed and corrected: synthetic subagent metadata was appended after
  messages rather than directly after its header (`backend.nLGbDyt3`,
  `focused.smXluwCA`, `guards.BpiCSmKF`, `diagnostic.5hwgeYCa` under
  `/tmp/pi-web-session-worktrees-*`); empty initial project/filter dereference
  (`browser.2d9BoP8D`); native-modal initial combobox focus covered Browse
  (`browser-fixed.1tJU51JF`, `browser-focus.XoLCGqoG`). No deadlines, assertions,
  production pins or isolation were weakened; passing runs followed identified fixes.
- These focused runs used previously cached dependencies; model/review/coordination time
  is not included. Full acceptance remains open and must use the reconciled candidate.

## Completion Checklist

- [ ] Existing individual session moves remain compatible, including deleted source cwd.
- [ ] Missing filters cannot change checkout or New/terminal destinations.
- [ ] Recovery includes archived and missing-child-only histories, with descendants shown.
- [ ] Focused and complete acceptance plus independent review pass; evidence recorded.
- [ ] Verified exact integration approved/performed, or feature retained with explicit blocker.
