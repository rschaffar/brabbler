# Chat file line links

## Goal

Make explicit chat links and inline-code file/line references navigate to source lines or their containing rendered Markdown blocks. The model supplies known function line numbers; no symbol resolver is introduced.

## Plan

- [x] Parse positive, safe line targets (`#L36`, `#L36-L48`, `:36`, `:36:5`), preserving path/security and PDF page behavior; verify parser tests.
- [x] Carry targets through chat and file tabs, including repeated clicks and already-open files; verify tab and renderer tests.
- [x] Scroll/highlight source lines and rendered Markdown blocks with original-source positions (including normalization/frontmatter); verify browser acceptance.
- [x] Document supported syntax and limits in the feature guide.
- [x] Run full offline baseline and affected browser acceptance on settled inputs; record artifacts and review.

## Non-Goals

Automatic symbol resolution, persistent/permalink browser URLs, immutable historical source snapshots and Markdown heading-anchor navigation are outside this change.

## Completion Checklist

- [x] Implementation and acceptance pass; independent review findings have targeted fixes and tests, including save-owner round trips.
- [x] Durable behavior is owned by `docs/feature-internals.md`; browser selection by `e2e/README.md`.
- [x] Implementation ready for local Git handoff. The global lifecycle, harness receipts and completion report own subsequent commit/integration/cleanup choices; this is not an additional implementation obligation.

## Acceptance Evidence

Commands used cached `nix develop --offline --no-write-lock-file .#test`; no production build, live credentials or installed-service contact.

- Final common baseline: `node nix/test-offline.mjs --jobs 4`, source digest `54a1a1e55ec396141a1ebd4096a0e627d31372cdb2c2b83ed0c9ee49ebf0acf3`; 282 files / 1,826 tests pass, plus type generation, typecheck, lint and exporter contracts. Evidence `/tmp/pi-web-test-offline.ZLBx2BQt/lifecycle.json`; execution 164.7 s, excluding shell preparation/model work.
- General browser acceptance: `npm run test:e2e`, earlier digest `19e5d9563de42dd91e31b01d1548931e52011b5bd20a57e7f1bdc4781635cf90`, passed desktop/mobile and broader UI/session flows with zero errors. Evidence `test-results/e2e/browser-7GzLj5/run.json`; suite 1,251.8 s. The final delta adds replacement-viewer save ownership protection and its focused browser case; it does not change unrelated browser flows.
- Final affected-flow acceptance: `env E2E_MARKDOWN_ONLY=1 npm run test:e2e`, same final digest as baseline, passes desktop/mobile explicit and inline links, repeated clicks, ranges, chunking, Markdown source/preview transitions, paragraph/list/code/math/frontmatter targets, missing lines, real delayed-save A→B→A read-only ownership and retained keystrokes. Evidence `test-results/e2e/browser-3bzjuz/run.json`; suite 114.6 s, excluding dependency/snapshot preparation.
- Earlier failures are retained: two static/test-expectation iteration failures, browser fixture registration/hidden controls, source→preview restoration, and the oversized edit request from an initial >1 MB fixture (replaced with a three-chunk <1 MB fixture without suppressing errors). One general browser run was interrupted by the outer tool's 1,200 s limit near completion; its exact owned orphan dev process was gracefully stopped and resources retained. The subsequent general run above used unchanged test deadlines and completed normally. Focused unchanged retries were not used as proof of a fix.
- Only settled current-run regenerable bulk was cleaned by launchers. Snapshots, fixture roots and diagnostics remain; any feature-resource cleanup is separately governed by the Git tool.

## Known Limits

Links identify current saved source coordinates, so subsequent edits can shift them. Columns navigate at line granularity. Rendered ranges highlight their starting block; no automatic symbol lookup or heading-fragment navigation is introduced.
