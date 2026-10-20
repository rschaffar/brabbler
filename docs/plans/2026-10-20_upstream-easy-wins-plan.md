# Selective upstream easy wins

## Goal

Adopt and review the seven shortlisted upstream improvements and four attractive extras in one feature worktree, then integrate the fully verified batch into local `rst-main` with one non-fast-forward merge and exact-state approval. User authorized implementation and combined integration; no remote operation or publication is authorized.

## Context

Base: `1fc4d380dc7781f035a21008083ee0b81f739ce0`. Upstream research snapshot: `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`, retained in `/tmp/pi-web-upstream-review.KEkJjU/repo.git`. Worktree: `../pi-web-worktrees/upstream-easy-wins`, branch `feat/upstream-easy-wins`. Parent session is sole writer/test coordinator; reviewers are read-only in the same worktree.

This batch does not own the separately identified preview-secret/transcript-authorization security findings, HTTP changes, MCP/settings redesign, streaming-render refactors, scanner optimizations or other larger features. Those remain explicitly deferred to the next review; this batch does not establish publication readiness.

## Plan

- [x] Port bounded SSE queues (`6b0c6a54`); test dropped repairable deltas, authoritative boundaries, slow-client teardown and preserved local liveness/receipt behavior.
- [x] Port asynchronous service-worker cache persistence (`37d40453`); test delayed and failed cache writes without blocking successful responses.
- [x] Port mobile terminal dimension clamping (`3ff7e1d7`); test actual accepted dimensions and preserved invalid-command/lifecycle guards.
- [x] Port mobile model-picker focus (`92ae057b`); verify desktop autofocus remains and mobile does not summon the keyboard.
- [x] Port `.agents/skills` metadata annotation (`42909b6d`); test global/project and legacy roots without expanding discovery or authority.
- [x] Port sidebar CSS activity animations (`80cd55ec`); preserve statuses, reduced-motion behavior and local Activity features.
- [x] Port runtime PWA name and manifest cache bypass (`2adb1855`); test defaults, trimming, runtime changes and stale cache bypass, document the option.
- [x] Port provider-ID/qualified-model searches (`df163cdb`); test case/whitespace and preserve account scope/order/grouping and demo parity.
- [x] Port composer Markdown list continuation (`fd037e47`); test markers, fences, selections, IME, send distinction and browser undo.
- [x] Port ordered-list indentation (`8347ea5c`); test large starts/digit counts and unchanged nested-list rendering.
- [x] Port overflowing panel-tab layout (`bf0730c1`); test desktop/mobile overflow without clipping and preserve tab actions.
- [x] Obtain independent reliability and interface reviews of all eleven changes; resolve findings before final acceptance. Reliability review found no remaining findings; interface review confirmed fixes for list-contained fences/indented code and the memory-only draft fixture.
- [ ] Run focused Nix checks while iterating, then complete core/static/plugin, all browser/terminal groups and genuine deployment VM acceptance after source/review settlement; record exact input identity, commands, runtime and artifacts.
- [ ] Reassess current local target, rebase if required, inspect clean candidate and obtain exact-state approval through the merge tool for one unsigned non-FF merge.

## Evidence so far

- Focused Nix core/static checks passed 10 selected files / 122 tests: `/tmp/pi-web-test-core.qY93AW/run.json`, outer source digest `c5685d8d3a43d3934c135a2034d2f1895031ff3f0e97b02a8f34543a6ee0ecc7`.
- Earlier focused core failure was an overescaped assertion regex in the new ordered-list test, not a renderer failure: `/tmp/pi-web-test-core.g8e3eI/run.json`; retained failed derivation `/nix/store/rmqcj3kv30xl2d5wprfg4388lcv76qqw-pi-web-core-checks.drv`.
- Initial packaged history run failed in the new fixture because its global option count included the two speed options; scope is now the model listbox. Evidence: `/tmp/pi-web-test-browser.PTVaZ8/run.json`. No application error suppression, retry automation or deadline increase.
- Review corrected an invalid localStorage/reload expectation: drafts deliberately remain memory-only, and the new browser check now exercises SPA session changes.
- After parser review fixes, `nix run .#test -- core --jobs 4 --file lib/markdown-list-continuation.test.mjs` passed in 38 seconds command wall time; `/tmp/pi-web-easy-wins-core.cgRhGv.log`.
- SSE intentionally retains upstream's soft threshold (one frame may overshoot), not a new maximum event size; the contract and regression make this limitation explicit.

- First complete acceptance at `cbfd137` failed after 194 seconds because the new fixture tried clicking the textarea beneath the open model-picker portal. It now closes through the real trigger. Evidence: `/tmp/pi-web-easy-wins-all.3VZeig.log`, `/tmp/pi-web-test-browser.autq45/run.json`; peer core was cancelled by the documented failure policy, not a passing full core run. No forced clicks or application changes were needed.
- Corrected packaged history passed in 52 seconds command wall time (40.248 seconds browser execution): `/tmp/pi-web-test-browser.brnSaO/run.json`. It covers desktop/mobile focus, qualified provider search, native list undo/redo, IME/failure fallback, runtime PWA naming and memory-only SPA draft retention.
- Three independent one-worker focused groups passed with source writers paused during export, combined wall time 152 seconds, digest `9410415627be2d15d8c1018135beacb69252abd7b52e9984d8dd5ab1396dac69`: terminal `/tmp/pi-web-test-browser.v0RlVq/run.json` (62.048 seconds execution), file-edit `/tmp/pi-web-test-browser.EBYwPK/run.json` (85.659 seconds), Markdown `/tmp/pi-web-test-browser.4OHWkf/run.json` (130.146 seconds). Logs: `/tmp/pi-web-easy-wins-focused.oVhimR/`. These remain focused evidence, not complete acceptance.

## Risks

Textual patch applicability is not semantic verification. Adapt upstream tests to the fork's stronger contracts; do not import obsolete instructions, translations, dependency downgrades or upstream packaging/test commands. Browser event ordering, SSE replay, global skill-root identity and runtime manifest caching need explicit regression coverage.

## Completion Checklist

- [x] All eleven bounded improvements implemented and reviewed, with upstream attribution in coherent feature history (`cbfd137` plus reviewed fixture follow-up).
- [ ] Full acceptance passes for the settled candidate; failures and unavailable evidence remain explicit.
- [ ] One approved local non-FF integration is verified; no remote publication occurs.
- [ ] Report feature/integration IDs, evidence, deferred scope and separately approved cleanup outcome.
