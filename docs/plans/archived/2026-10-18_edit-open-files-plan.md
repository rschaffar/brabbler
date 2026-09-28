# Edit open text files

## Goal
Allow a writable, existing UTF-8 text file opened in the Files panel to be edited and explicitly saved without silently losing a draft or overwriting an external change.

## Non-Goals
Binary/media editing, creating new files, editing files outside the writable file-root allow-list, automatic save, and durable drafts across browser reloads.

## Architecture
A bounded full-file edit snapshot and revision is separate from the existing chunked read-only preview. PUT saves only an authorized regular file if its on-disk bytes still match the snapshot. The tab owner retains dirty drafts while the viewer is unmounted on tab changes; watch updates must not replace dirty content.

## Plan
- [x] Add bounded full-file edit and guarded save in `lib/file-edit.ts` and `app/api/files/[...path]/route.ts`; focused `lib/file-edit.test.mjs` passes (4 cases covering authorization, permissions, formats, sizes, conflicts and mode).
- [x] Add edit/save UI, dirty and external-change behavior in `components/FileViewer.tsx`; retain drafts and protect tab closure in `components/AppShell.tsx` and `components/TabBar.tsx`. Focused `E2E_FILE_EDIT_ONLY=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome) npm run test:e2e` passed at 1280px and 390px (save, tab switch, conflict, discard, dirty close).
- [x] Document the editing behavior in `README.md` and `AGENTS.md`; `npm test` (1543 pass), `node_modules/.bin/tsc --noEmit`, `npm run lint`, and focused browser E2E pass. Earlier full browser runs reached and passed edit flows at both sizes, then timed out in mobile archive/search (`e2e/run.mjs:881`) or history restoration (`:774`); **after rebasing onto `rst-main` f9c5f46**, full `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome) npm run test:e2e` passed desktop and mobile flows, including the repaired archive check. No production build.

## Risks
A compare-and-rename is not atomic against external filesystem writers. Failed saves keep the draft. Replacing a file via rename can change inode/hardlink identity; document this boundary if retained.

## Rollback / Recovery
No migrations. Revert the feature commit for code rollback; a successfully saved user file is user data and must not be automatically rolled back. Conflicting drafts remain in the browser until dismissed.

## Completion Checklist
- [x] A writable small UTF-8 file can be edited and saved; read-only, binary, oversized and escaped paths cannot be saved (focused unit and browser tests).
- [x] Concurrent external changes produce a visible conflict without destroying the draft; tab switches preserve it and closing a dirty tab prompts (focused browser tests).
- [x] Required checks pass on the rebased feature candidate, and the reviewed feature is ready for exact-state local integration approval. Local integration remains separately human-approved.
