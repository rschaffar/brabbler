# Browser memory retention

Status: Complete — implementation and verification.

## Goal

Reduce confirmed client retention without changing transcript persistence, history navigation, unsaved drafts, or terminal lifetimes. This is a source-led first pass, not attribution of an observed browser-process peak or a measured whole-tab memory reduction.

## Plan Relationship

`docs/production-performance.md` continues to own the separate deferred production catalogue/SPA measurements. Existing Git-review and test-optimization plans are unchanged. This slice owns only message rendering, deferred thinking cache ownership, and minimap drag cleanup. The repository Git lifecycle separately owns exact-state approval, local main integration and cleanup; implementation-plan completion grants none of those operations.

## Plan

- [x] Project tool results to each message before the memoized rendering boundary; verify unrelated results cannot be retained by the child and duration work scales with that message's calls.
- [x] Bound deferred thinking retention by count and estimated string bytes, refuse oversized cache entries, and release collapsed component content; verify sharing, eviction, failures and late results without discarding displayed content.
- [x] Dispose minimap drag listeners on completion, replacement, blur and unmount; verify real mounted component cleanup and existing navigation behavior.
- [x] Run focused Nix regression/static checks with meaningful runtime counterexamples, obtain independent review, then run complete `all --workers 4 --jobs 12` acceptance with resource admission.
- [x] Document current ownership and proof limits in the session guide.

## Non-Goals

No live private heap capture, service restart/deployment, remote publication, transcript/history virtualization, file/diff/media/terminal eviction, or Mermaid scheduling change. No fixed RSS or GC-timing promise. Synthetic policy/ownership assertions do not quantify production memory savings.

## Evidence and assertion disposition

The first coherent focused candidate passed seven files / 85 tests. Its tool-result projection case retains exactly 2,000 message-local result references for 2,000 one-call messages, with shared payload identity and no whole-map scan; this is structural work/retention evidence, not a measured heap saving.

Expanded-only thinking now unmounts its stateful body rather than merely clearing a still-mounted state value. At base `14d60757535e0ed78ff3753fda1372b0e4c47bbb`, `components/ChatWindow.process-details.test.mjs:418-472` expected one effect tail per expansion. The new StrictMode body mount legitimately produces two tails. The revised test groups both by the original session/entry/block identities and retains exactly three GETs, one JSON consumption each, shared request identity across reopening, callback-only non-admission, and independent complete joining of every cancelled/current/replayed tail. The observed `6 !== 3` failure is retained; no original request/input or browser bridge was removed.

Three temporary production faults each produced their intended runtime failure: passing the whole tool-result map across the memo boundary, relaxing the aggregate thinking payload cap, and omitting minimap unmount cleanup. All three files were restored byte-identically before positive verification. A separate initial minimap-fixture failure came from inconsistent supplied geometry (22-pixel rectangle versus 300-pixel client height); the test now uses the actual rendered node coordinate in a matching rectangle. Neither failure was hidden by an unchanged retry.

## Full verification

Candidate `2dbe1aa0d95b054d08d55a575936c7a2d4f389e4`, source-export SHA256 `935c381726f0fac4829435b4b0dea9379668d52274a4869459e2d0393cfddbcd`, passed `nix run .#test -- all --workers 4 --jobs 12`:

- Core: 525 files / 4,450 tests; 33 exporter contracts and matching declared-input static checks also passed.
- Browser/terminal: all 26 groups / 58 exact inventory receipts passed using installed production packages in ordinary Nix sandboxes.
- Genuine Home Manager deployment VM: all five activation, permissions, write, restart-persistence and production-PTY checks passed.
- Requested/effective widths: 12 core workers and four browser sandboxes. The runner admitted serial levels because its available-memory estimate was 39.1 GiB, below the 43 GiB overlap requirement; no coverage was omitted.
- Command wall time: 918 seconds, including in-run realization. Core: 432.2 seconds total, with a 425.4-second file-execution window and 6.4 seconds before the first file. Browser: 410.2 seconds total; support/manifest preparation 83.6 seconds, group execution/validation window 326.6 seconds. Service command: 60.4 seconds; separate realization/execution intervals were not recorded. These are verification intervals, not a memory or warm-prerequisite performance benchmark.

Private retained evidence includes `full-1.log`, source manifests, three run reports, the admission record, `full-1-summary.json`, focused/fault logs and independent-review session findings. No private transcript or live heap capture was used. This closure/archive changes documentation only; application and test inputs remain those of the verified candidate.

## Completion Checklist

- [x] Focused regression and meaningful failure evidence retained: restored candidate passes four affected files / 51 tests; three fault variants produce their named runtime failures, with byte-identical application restoration. Source-only independent review and the StrictMode assertion-diff review found no blocker.
- [x] Independent review resolved and full core/browser/service acceptance recorded against exact source inputs.
- [x] Maintained documentation updated; completed plan archived.
- [x] Exact candidate and verification evidence prepared for the repository Git lifecycle; local main integration and cleanup remain separate native gates.

## Why Closed

The bounded implementation and regression work is complete, including meaningful failing controls, independent review and full acceptance. Current behavior and proof limits live in `docs/session-internals.md`; larger lifecycle changes and live memory attribution remain out of scope. Native Git receipts own subsequent integration and cleanup rather than a hand-edited post-merge plan status.
