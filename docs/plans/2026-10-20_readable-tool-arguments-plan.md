# Readable tool arguments

## Goal

Port upstream's flat argument rows, preserving complete argument access and this fork's immutable history, streaming, special renderers, receipts and security boundaries.

## Context

User explicitly approved implementation after the chat-only assessment. Base `rst-main`: `1fe0a04c2d6d11e0c301457e379289d3a61f1508`; isolated branch `feat/readable-tool-arguments`, worktree `../pi-web-worktrees/readable-tool-arguments`. Cached upstream `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`, lead `083fd11ba54674d0939e809e567d90ad78abacab`, write-view prerequisite `038057f4797568394fd2a8f4a800e2e5d1bef071`. No remote, live provider, credential/session-data access or installed-host deployment is authorized.

## Plan Relationship

Earlier easy-wins/security/followup ports are complete and archived. This plan owns only argument presentation and its acceptance, not streaming architecture, message identity, file authority, SDK/codemode/MCP redesign or dependency changes. Maintained feature/session guides own the resulting contract. The global Git lifecycle owns later completion intent, exact-state integration approval and separately approved cleanup.

## Plan

- [x] Add pure flat-field/write-view selection with complete fallback; verify scalar/nested/empty/unsupported inputs and conservative write eligibility in focused core tests.
- [x] Add escaped, accessible argument rows, raw disclosure and canonical full copying; preserve rich views and show edit input without a usable diff. Verify MessageView rendering and desktop/mobile browser interactions.
- [x] Mirror bounded presentation changes in demo without replacing its renderer; inspect exact helper/component/clipboard parity and update maintained owning guides.
- [x] Obtain independent read-only safety review and resolve concrete findings before final acceptance. Final bounded follow-up found no remaining blockers; no reviewer ran tests or wrote source.
- [ ] Run focused Nix core/history checks, then fresh full `nix run .#test -- all --workers 4 --jobs 4` after admission; record exact identities, commands, results, timings and artifacts, retaining failures.
- [ ] Commit coherent reviewed changes; resolve completion intent and hand the verified clean candidate to the mandatory local `rst-main` non-FF integration lifecycle.

## Risks

Long labels must not clip on phones; multiline scroll regions need keyboard access. Display strings never become Markdown, links or file authority. Rows and write text are not canonical JSON: copying always uses original complete input or exact partial raw input. Result errors/unknown tools and complete nested edits retain readable fallbacks. No persisted-data migration, dependency/pin change or deployment is included. The main agent is sole writer/test coordinator; researchers/reviewers are read-only.

## Focused evidence and corrections

- First focused core failed after 126s command wall time: `/tmp/pi-web-tool-arguments-core.mXNfEL.log`, `/tmp/pi-web-test-core.UoWmxC/run.json`. New SSR assertion incorrectly expected React's `tabIndex` spelling in emitted HTML; corrected to native lowercase `tabindex` without changing the application.
- Next focused core failed after 53s: `/tmp/pi-web-tool-arguments-core.Jozev4.log`, `/tmp/pi-web-test-core.6wCxNk/run.json`. New cross-demo parity assertion could not read `demo/`, intentionally absent from root's Nix source export. Removed that invalid cross-fileset assertion rather than expanding the export or skipping a test; direct source inspection (`cmp`) confirms helper/component/clipboard identity. Demo remains independently compiled, not claimed browser-tested by root acceptance.
- First history run failed after 153s including package realization: `/tmp/pi-web-tool-arguments-history.5KorXf.log`, `/tmp/pi-web-test-browser.9D9sgt/run.json`. Font fixture changed a document variable shadowed by chat's local variable; scope the test override to the argument body. No application/style change, deadline increase or suppressed error.
- Focused core passed 9 files / 80 tests with four workers, 75s command wall time: `/tmp/pi-web-tool-arguments-core.Yg4B3G.log`, `/tmp/pi-web-test-core.OEVrFb/run.json`. Includes static preparation and the original MessageView/clipboard/streaming/source-authority regressions.
- Desktop 1280px and touch-mobile 390px history passed, 57s command wall time / 41.780s inner execution: `/tmp/pi-web-tool-arguments-history.JQd2L3.log`, `/tmp/pi-web-test-browser.7Uybtk/run.json`. Both focused runs exported digest `ff30377dac7e0d88c7bf7a79b02234c7c6435f23b880d92cc49965e91831a504`; commands include preparation/realization and are not benchmarks.
- Independent review fixed the demo clipboard fallback's pre-existing false-success behavior and conditional raw-disclosure ARIA target. Subsequent fixture review identified a possible initial-state race; now await the idle mount response before synthetic streaming, and abort failed intercepted reads before reporting them. This post-pass fixture refinement still requires subsequent browser/full acceptance.

## Completion Checklist

- [ ] Rows/write/raw/copy/fallback behavior is covered without changing historical entry IDs, source links, receipts or process grouping.
- [ ] Independent review resolved and full core/static/plugin, browser/terminal and genuine deployment-VM acceptance passed for the recorded candidate.
- [ ] Maintained guides updated; exact feature/integration status and any gaps reported without claiming deployment or publication.
