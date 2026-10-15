# Local file link guidance and rejection feedback

## Goal

Prevent assistants from emitting sibling-worktree links that Pi Web treats as website URLs, and explain rejected relative links without navigating. Implementation is user-authorized; integration, publication and cleanup remain separate.

## Context

Installed 0.9.3 rejects relative paths outside the session cwd (Markdown previews use the document directory with a session-root boundary), then falls back to browser navigation. Absolute filesystem links remain supported subject to the existing server file-access checks. Current generic assistant guidance does not describe this distinction. No active plan owns this behavior.

## Plan

- [x] Add narrowly scoped Pi Web assistant guidance for absolute file links, source coordinates, hostname avoidance and truthful link-validation claims; test startup/reload registration while preserving exact prompt contracts.
- [x] Expose local-link rejection reasons without changing path resolution or server authorization; unit-test relative boundaries, encoded paths, Windows/UNC, web URLs and preview bases.
- [x] Show shared accessible rejection feedback in chat and Markdown previews, with no navigable href; verify component and desktop/mobile browser regressions including valid absolute sibling links.
- [x] Update the feature guide and browser coverage description; run independent safety review, common offline acceptance and affected Markdown browser acceptance on settled source.

## Non-Goals

No filesystem allow-list widening, automatic repair of old documents, heading-anchor implementation, installed-service activation, production build or remote publication.

## Completion Checklist

- [x] Focused regressions, full common baseline and affected browser acceptance pass; record input identity, commands, timings and artifacts below.
- [x] Review findings are resolved and maintained documentation describes the current contract.
- [x] Commit reviewable work in the isolated feature checkout; implementation commit `71418cf01d602232fb7297cb53a7b364d2418317` is clean and the user selected local integration into `rst-main` by the required unsigned non-fast-forward merge. Exact-state merge approval and cleanup retain their separate tool gates.

## Verification and review evidence

Base: `e18ac91ef3afb769ef97b48917ef49e9c7adcab0`, branch `fix/local-file-link-guidance`, checkout `/home/robert/projects/3rdparty/pi-web-worktrees/local-file-link-guidance`.

- Dependency preparation: `nix develop --offline --no-write-lock-file .#test -c node --version` failed before checks on the pinned toolchain's fixed-output hash mismatch (`cb41cbfe717e4c00d7bb70035cda5ee5f0ff9341.tar.gz`). The documented npm alternative was used instead. `npm ci --offline` lacked a cached package; ordinary `npm ci --no-audit --no-fund` prepared matching local dependencies in 9 seconds. No manifest, lockfile, marker or Nix input was changed. Preparation is separate from check runtimes.
- Focused iteration: `node --experimental-strip-types --test --test-concurrency=1 lib/file-links.test.mjs lib/local-file-link-guidance.test.mjs components/MarkdownBody.test.mjs components/FileViewer.test.mjs lib/chat-only.test.mjs lib/subagent-prompt.test.mjs lib/session-reference.test.mjs`, 57/57 at the earlier iteration checkpoint, `/tmp/pi-file-links-focused.log`. Subsequent stable-renderer changes are covered by the final common baseline below.
- Final common baseline: `node_modules/.bin/next typegen`, `node_modules/.bin/tsc --noEmit --incremental false`, `npm run lint` all passed (31 seconds combined), then `npm test` passed 1,906/1,906 tests, no skips (39 seconds). Logs: `/tmp/pi-file-links-{typegen,typecheck,lint,core}-final.log`. An earlier full run failed one obsolete factory-list assertion; it was updated while preserving exact-prompt exclusion checks, and the final run passed.
- Affected browser acceptance: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/nix/store/ini1ifgvcsvw48x4mxawrv9jvbdwn70p-chromium-155.0.8059.79/bin/chromium E2E_MARKDOWN_ONLY=1 npm run test:e2e`, passed desktop 1280px/mobile 390px in 119 seconds. Source digest `97792c0080c550e88e91ee3e4f24ee09be475600132b63d938a7f076b1cd057c`; artifacts `test-results/e2e/browser-XsiEzb/`, source/fixture root `/tmp/pwe-t9QvQz`. Run lifecycle confirms passed/settled and owned regenerable bulk removed. Source is unchanged apart from this evidence update.
- The first browser attempt (`test-results/e2e/browser-vhgTd5/`, `/tmp/pwe-3pGsCa`) correctly rejected the fixture's unregistered absolute sibling with 403. The fixture now uses its existing authorized other-project session root; no app authorization was widened or console error suppressed.
- Independent source review found preview renderers could remount the feedback on refresh. A stable module-level renderer/context and real unchanged-watcher-read focus regression resolve that finding. Follow-up review found no remaining blockers. Reviewer did not run acceptance.
- Broader browser acceptance was attempted on the same application inputs/digest with `npm run test:e2e` and the same Chromium. The outer command timed out after 600 seconds; this is **not** a full-suite pass. It had reported passing desktop/mobile model-speed, running-fork and session-launch flows plus desktop manager checks. Retained evidence: `test-results/e2e/browser-qN8VaO/`, `/tmp/pi-file-links-browser-full.log`, source/fixture root `/tmp/pwe-1pMcuz`. The supervisor's final settlement record was not written, so no bulk cleanup was performed. The exact remaining owned Next process received graceful SIGTERM; a bounded process scan found no remaining command lines under this run root. Interrupted-run artifacts remain retained, not certified for cleanup.

Plan complete; maintained behavior lives in `docs/feature-internals.md` and the affected browser selection in `e2e/README.md`. This final evidence/archive-only follow-up does not change the tested application inputs. Required common and affected-flow acceptance is complete; broad full-browser coverage remains explicitly incomplete. No production build, terminal/plugin implementation change, installed-service activation or remote operation was performed. Existing Markdown documents are not rewritten, and user custom/exact prompts retain their overriding behavior. Local integration and feature cleanup remain separate decisions.
