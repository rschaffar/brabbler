# Browser memory retention

## Goal

Reduce confirmed client retention without changing transcript persistence, history navigation, unsaved drafts, or terminal lifetimes. This is a source-led first pass, not attribution of an observed browser-process peak or a measured whole-tab memory reduction.

## Plan Relationship

`docs/production-performance.md` continues to own the separate deferred production catalogue/SPA measurements. Existing Git-review and test-optimization plans are unchanged. This slice owns only message rendering, deferred thinking cache ownership, and minimap drag cleanup. The repository Git lifecycle separately owns exact-state approval, local main integration and cleanup; implementation-plan completion grants none of those operations.

## Plan

- [x] Project tool results to each message before the memoized rendering boundary; verify unrelated results cannot be retained by the child and duration work scales with that message's calls.
- [x] Bound deferred thinking retention by count and estimated string bytes, refuse oversized cache entries, and release collapsed component content; verify sharing, eviction, failures and late results without discarding displayed content.
- [x] Dispose minimap drag listeners on completion, replacement, blur and unmount; verify real mounted component cleanup and existing navigation behavior.
- [ ] Run focused Nix regression/static checks with meaningful runtime counterexamples, obtain independent review, then run complete `all --workers 4 --jobs 12` acceptance when resource admission allows.
- [x] Document current ownership and proof limits in the session guide.

## Non-Goals

No live private heap capture, service restart/deployment, remote publication, transcript/history virtualization, file/diff/media/terminal eviction, or Mermaid scheduling change. No fixed RSS or GC-timing promise. Synthetic policy/ownership assertions do not quantify production memory savings.

## Evidence and assertion disposition

The first coherent focused candidate passed seven files / 85 tests. Its tool-result projection case retains exactly 2,000 message-local result references for 2,000 one-call messages, with shared payload identity and no whole-map scan; this is structural work/retention evidence, not a measured heap saving.

Expanded-only thinking now unmounts its stateful body rather than merely clearing a still-mounted state value. At base `14d60757535e0ed78ff3753fda1372b0e4c47bbb`, `components/ChatWindow.process-details.test.mjs:418-472` expected one effect tail per expansion. The new StrictMode body mount legitimately produces two tails. The revised test groups both by the original session/entry/block identities and retains exactly three GETs, one JSON consumption each, shared request identity across reopening, callback-only non-admission, and independent complete joining of every cancelled/current/replayed tail. The observed `6 !== 3` failure is retained; no original request/input or browser bridge was removed.

Three temporary production faults each produced their intended runtime failure: passing the whole tool-result map across the memo boundary, relaxing the aggregate thinking payload cap, and omitting minimap unmount cleanup. All three files were restored byte-identically before positive verification. A separate initial minimap-fixture failure came from inconsistent supplied geometry (22-pixel rectangle versus 300-pixel client height); the test now uses the actual rendered node coordinate in a matching rectangle. Neither failure was hidden by an unchanged retry.

## Completion Checklist

- [x] Focused regression and meaningful failure evidence retained: restored candidate passes four affected files / 51 tests; three fault variants produce their named runtime failures, with byte-identical application restoration. Source-only independent review and the StrictMode assertion-diff review found no blocker.
- [ ] Independent review resolved and full core/browser/service acceptance recorded against exact source inputs.
- [ ] Maintained documentation updated; completed plan archived.
- [ ] Exact candidate and verification evidence prepared for the repository Git lifecycle; local main integration and cleanup remain separate native gates.
