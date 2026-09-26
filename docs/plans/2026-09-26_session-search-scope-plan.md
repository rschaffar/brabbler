# Session search that follows the sidebar

## Goal

Make session search behave like a filter on the currently selected project's Active or Archived chats by default. Searching across projects, or across both archive states, must require an explicit, visible choice. Improve findability and result clarity without building a persistent search index or changing session files.

## Context

- `SessionSidebar` already derives `selectedProject`, `filteredSessions`, and `sessionFamilies` from the selected project and `showArchived` (`components/SessionSidebar.tsx`). Linked Git worktrees share a project key (`lib/project-groups.ts`, `lib/workspace-memory.ts`).
- The search UI instead sends only `q` and `includeArchived` (`components/SessionSearch.tsx`); `app/api/sessions/search/route.ts` searches every project's active family by default, and its checkbox adds archived families regardless of the sidebar view. Search results replace the list, so the archive toggle can appear to have no effect.
- Search currently matches session IDs and literal, case-insensitive user/assistant text, but not renamed titles or the catalogue's first-message preview (`lib/session-search.ts`). It returns one match per session, prioritizes ID hits, and caps scanning at 500 files / 3 seconds and results at 30. `truncated` denotes an incomplete search, not a definitive no-match.
- `docs/plans/2026-10-18_session-archive-plan.md` owns the archive feature and records its intentional default exclusion from active search. This plan owns only search scope and presentation; archive persistence and bulk actions remain there.

## Plan Relationship

Retain the archive plan's distinction between Active and Archived. This plan changes search to follow that distinction and adds an explicit opt-in to search both states; it does not alter which sessions are archived or how they are stored.

## Assumptions

- “Visible chats” means eligible families in the current project and archive view, including their subagents, across the project's linked worktrees; it does **not** mean only rows currently in the scroll viewport or only the current worktree.
- A text query continues to match message content as well as session metadata. Empty query shows the ordinary, unfiltered sidebar list.
- Search remains a lightweight results view with jump-to-message snippets, rather than reimplementing the sidebar's row actions, virtualized family tree, or bulk selection in results.

## Architecture

- `SessionSidebar` owns search scope: project = current project's stable server-provided key by default; archive state = the existing Active/Archived view. Replace “Include archived” with a clearly labeled **All projects** control and an optional **Both active and archived** control. Both are off when opening search and after closing it. Changing the sidebar's archive view updates the search's default archive state; an explicit Both selection stays visibly on until turned off or search closes. A project switch updates the current-project scope; it never silently widens an unknown project to global search. If there is no selected project, prompt the user to select one or explicitly choose All projects.
- `SessionSearch` requests `q`, an explicit project scope (`projectKey` or `scope=all`), and `status=active|archived|both`; include each scope value in its request identity so switching scope clears old results and cancels in-flight requests. Keep debounce and stable results during ordinary agent-activity polling. Offer explicit Retry/Refresh for failed or stale results rather than re-running on every list version bump.
- The route validates the enum and project selection, filters the catalogue to eligible families **before** file scanning, and applies archive status to family roots. Compare project keys with `workspaceKeyOf`, matching the sidebar. An invalid or missing project must never silently become an all-project search. Ensure moved/archived/deleted results are not treated as an authoritative live list; a manual refresh re-reads the catalogue.
- Extend the search engine to match renamed session title, catalogue first-message preview and ID from catalogue metadata before content scanning. Preview hits may use a bounded file read to recover the matching entry ID for navigation; they remain findable if that read fails. Search other user/assistant text using existing literal matching and bounds. Deduplicate per session, show the reason for the match (title, preview, ID, message) and its snippet; preserve message jump targets for content hits. Rank exact/prefix metadata matches first, then other metadata, then content; sort ties by most recent activity, with a documented deterministic tie-break. Avoid letting a full metadata page imply the content scan completed. For All projects results, show a human-readable project label (and archived/subagent context when relevant) instead of only cwd.
- Distinguish “No matches in this scope” from “No matches in the files checked; search was incomplete”; show the scope, number returned, and partial-results notice together. Keep result data small and do not expose file contents beyond existing snippets.

## Non-Goals

- Persistent full-text index, fuzzy/semantic matching, query operators, pagination, searching tool results/thinking, and rewriting session transcripts.
- Searching only the current conversation branch: existing content search includes historical user/assistant messages, including inactive branches. Revisit separately if users need branch-aware semantics.
- Bulk actions on search results, changing the archive implementation, or searching file explorer content.

## Risks

- A project-scoped query that filters *after* the 500-file/3-second scan could miss relevant chats; scope must be applied before scanning.
- Catalogue metadata can differ from message content or become stale while a search is displayed. Explain metadata matches and provide explicit refresh; do not reorder results on every activity poll.
- Existing clients/tests or the interactive demo may still send `includeArchived`; decide whether to reject it with a clear error or support a short compatibility window, but never let a missing project scope default to global in the new UI. Use route tests to pin the chosen contract before replacing the parameter.
- A family with a subagent in a different project must follow the sidebar's established family eligibility rule, not appear unexpectedly in current-project results.

## Plan

- [x] Confirm the scope contract: missing project/status and legacy `includeArchived` return 400, an unknown project key yields no hits, a no-project browser selection prompts instead of searching, and families are grouped *after* project filtering. Route, project-groups, and sidebar source tests cover these decisions.
- [x] Add an explicit project/status filter to `app/api/sessions/search/route.ts` using the sidebar's family/project semantics; focused route and `lib/project-groups.test.mjs` tests pass for active, archived, both, all-project, missing/invalid scope, and stable worktree identity.
- [x] Extend `lib/session-search.ts` with title/preview/ID matching, deterministic ranking, deduplication and accurate partial-result reporting while retaining bounded literal content search and jump offsets; `lib/session-search.test.mjs` passes, including caps, missing files, Unicode and abort.
- [x] Replace the archive checkbox in `components/SessionSidebar.tsx` with explicit All projects/Both statuses controls wired to the current project and archive view; `components/SessionSidebar.test.mjs` covers the scope wiring, resets, no-project request guard, and stale response identity. Browser E2E remains blocked below.
- [x] Update `components/SessionSearch.tsx` to explain scope and match type, render project/archived context and honest partial/empty/error messages, and expose explicit Retry/Refresh; source tests pass for scoped request identity and cancellation. Browser selection E2E remains blocked below.
- [x] Update locale strings, the interactive demo search contract, and the search/archive description in `README.md`; locale parity, typecheck, lint and source tests pass. Browser demo validation remains blocked below.
- [ ] Run all required checks. `npm test` passed (1,381 tests), `node_modules/.bin/tsc --noEmit` passed, and `npm run lint` passed in the feature worktree. `npm run test:e2e` reached Chromium launch but failed because `libglib-2.0.so.0` is unavailable in this NixOS environment; browser checks remain open. Do not run a production build during development.

## Completion Checklist

- [x] Route, project/family, and sidebar tests confirm project A's Active and Archived families stay in their respective scopes across worktrees; empty query preserves the ordinary list.
- [x] All projects and Both statuses require independent opt-ins; request keys include both scopes and cancellation prevents old responses from appearing after a switch (source tests and typecheck).
- [x] Engine tests confirm title/preview/ID/content matches, preview and content jump offsets, deduplication, and honest partial results; browser interaction still awaits E2E.
- [ ] Browser E2E remains unavailable: Playwright's Chromium cannot load `libglib-2.0.so.0` on this host. All other required checks passed; rerun browser flows when dependencies are available.
