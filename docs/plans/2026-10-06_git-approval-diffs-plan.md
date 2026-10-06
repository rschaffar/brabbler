# Structured blocking cards and stacked Git diffs

## Goal

Make Git approvals and other blocking chat cards compact and scannable, and support multi-file review using stacked collapsible diffs in approvals and Git Explorer.

## Plan Relationship

Extends the completed optional Git Workflow plugin and inline-question-card plans; preserves their permissions, pending-request transport, cancellation, timeout and reconnect contracts. Git Explorer remains independent and committed-object-only.

## Approved Design

- Shared compact header/body/footer styling for plugin approvals, ask_user, select, confirm, input and editor cards. Bounded height with body scrolling and fixed actions; no overlay or persisted historical cards.
- Git-specific structured summaries are supplied by the plugin, not parsed from text in core. Exact message, required checks, approval scope and relevant warnings remain visible. Technical details are expandable.
- Stacked file sections replace Explorer's picker. First file opens initially; Expand all / Collapse all; shared split/unified/raw controls. Explorer patches load on expansion with bounded concurrency; collapsed diffs do not mount their renderers.
- Binary, metadata-only, oversized and parse/load failure states remain explicit. Approval retains the complete supplied raw patch. Diff presentation never authorizes only one file or changes the captured candidate.
- Files panel's legacy renderer, Git execution/permissions, custom extension overlays and historical tool output are out of scope.

## Plan

- [x] Add bounded structured presentation fields to generic plugin cards and populate operation-specific Git summaries; verify payload validation and Git preview tests without changing fingerprints/effects.
- [x] Add reusable stacked patch presentation and controlled single-file views; verify multi-file, rename, binary, metadata, malformed and oversized patch cases with focused tests.
- [x] Replace Explorer's picker with the lazy bounded stack; verify first expansion, collapse/expand, error isolation and stale-request cancellation in browser acceptance.
- [x] Share compact blocking-card shell/styles across plugin, ask_user and ordinary extension dialogs; preserve keyboard, submit, collapse, cancellation and timeout behavior with regression and browser coverage.
- [x] Update maintained Git/card documentation and run focused tests, then full npm tests, typecheck, lint, plugin integration tests and affected desktop/mobile browser flows. Never run a production build.

## Completion Checklist

- [x] All agreed surfaces implemented and tested; checks and any failures recorded honestly.
- [ ] Maintained docs describe current behavior; fully verified plan archived only after acceptance.
- [ ] Reviewable feature commit(s) and exact candidate presented for separately approved unsigned non-FF integration into local rst-main. No publication or cleanup inferred.

## Acceptance Evidence

Accepted implementation workspace (before feature commits):

- `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: 234/234 files, 1,514/1,514 tests, all exporter/typegen/typecheck/lint phases passed; no failed/skipped/unstarted/uncertain files or observed survivors. Log `/tmp/pi-git-approval-full-final.log`.
- Ordinary `npm test`, `node_modules/.bin/tsc --noEmit`, and `npm run lint` also passed in the matching private source copy with eight-CPU affinity and credential-free environment: 1,515 tests passed. Separate plugin Node selection passed 15/15. Log `/tmp/pi-git-approval-baseline-final.log`.
- Full `npm run test:e2e` passed desktop/mobile, including Explorer lazy reads, cache reuse, stale patch cancellation, local error/retry isolation, first-parent merge inspection, blocking-card focus/drafts/cancellation/expiry and long-title footer reachability. Log `/tmp/pi-git-approval-browser-final.log`.
- `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` passed at 1280px and 390px: all six action layouts, two-file shared views, collapse state, real commit approval, rejection, reconnect, cancellation, disable and Stop. Log `/tmp/pi-git-approval-plugin-browser-accepted.log`.
- Early browser attempts exposed fixture assumptions: duplicated hidden technical-detail text needed scoped selectors; Strict Mode may cancel/replay the first patch read. Loader deferral now avoids starting already-cancelled mounts and handles synchronous errors. Full acceptance also exposed the existing DOM-only Models-shortcut click after reload; the test now waits for a client-owned control and uses real Settings navigation, without forced clicks. No provider-account production behavior changed. Earlier failures and screenshots remain retained outside the checkout.
- Read-only review found focus loss on card collapse/reopen and an indefinite percentage header cap. Both were corrected and covered by keyboard/long-title browser checks.
- Terminal acceptance is not applicable: no terminal integration changed. No production build, service change, publication, integration or resource cleanup occurred.
