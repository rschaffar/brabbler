# Browser memory lifetimes

## Goal

Bound avoidable browser retention during long use while preserving saved history, the reader's position, unsaved edits and live terminal ownership. Address live transcript windows, inactive preview resources and Mermaid's process-lifetime rendering caches. This does not attribute a reported whole-browser memory peak or promise a fixed RSS ceiling.

## Plan Relationship

This is a follow-up to the completed browser-memory-retention plan. That slice fixed message-local result projection, deferred-thinking payload budgets and minimap drag cleanup; it did not bound live transcript windows or external renderer globals. Current behavior belongs to session/feature guides. Existing notebook-authoring, Git-review, dependency and test-optimization plans keep their separate scopes. Test additions preserve their original assertion/input obligations and full native/browser acceptance.

## Architecture and constraints

- Persisted transcripts and server authority remain unchanged. The user explicitly chose a reader-aware soft bound: keep the live tail small; deliberately loaded scrollback and newer messages remain until returning to the tail, then older pages are released. No Older/Newer navigation UI. Preserve entry IDs, call/result pairing, exclusive reload cursors, active/unpersisted work and canonical missed-event recovery; do not move discarded bodies into another client cache.
- Keep dirty/saving edit owners alive; a reverted clean draft must not pin a hidden viewer. Selected readers retain navigation state, but hidden native previews must release executable/decoding resources. Returning to a hidden preview may recreate it rather than preserve its script state.
- Mermaid rendering uses a disposable trusted same-origin frame, with bounded admission and cancellation. The former implementation evaluated Mermaid in the parent; this changes lifetime, not execution authority or security isolation. Same origin preserves authorized local images without a proxy/new file grants. Authored code is port data, never HTML interpolation. Keep strict Mermaid sanitization, the image-consent gate and parsed-to-render recheck, CSP, current SVG/source/zoom/download and stale guards. Standalone untrusted HTML remains opaque `sandbox="allow-scripts"`. No undocumented library-cache mutation or arbitrary diagram-source execution.
- No private heap/transcript capture, host service access, deployment, remote operation or terminal eviction. Keep one repository writer and independently review boundaries.

## Plan

- [x] Implement bounded live/loaded chat ownership with recoverable history and stable off-tail reading; verify the real policy and mounted hook, including call/result pairs, stale reads, live completion and repeated large inputs.
- [x] Release clean inactive file owners and hidden preview resources without losing dirty/saving editors; verify actual workspace/viewer visibility and repeated hide/show transitions.
- [x] Isolate Mermaid rendering in a disposable bounded owner; verify cancellation, repeated renders, remote-image gating and rendered SVG with the installed browser.
- [ ] Run focused Nix checks and meaningful production-fault controls, obtain independent safety review, then complete full core/static/browser/terminal/deployment acceptance on the settled candidate.
- [ ] Update maintained contracts, record exact verification/proof limits and archive the completed implementation plan. Native Git approval separately owns local non-fast-forward integration and cleanup.

## Unknowns and stop conditions

Installed-browser qualification of the disposable realm, CSP, local-image compatibility, SVG math/theme/download and frame destruction is required before completion. The user resolved the history-window choice in favor of preserving deliberate scrollback, not fixed-size historical pagination. Soft limits explicitly exempt one indivisible payload/dependency group, unanswered active work and unpersisted entries; they are not a browser-heap ceiling. If preservation/recovery or resource compatibility needs a further compromise, stop rather than silently discard data.

## Assertion disposition

At baseline `7b151f990418cf8114741f922e8096370b79cae2`, `FileMarkdownBody.presenter-work.test.mjs:145-159` required the actual parent-realm Mermaid renderer to finish through unmount. That boundary is intentionally retired: default rendering now belongs to a disposable frame, with Source/unmount cancellation. The mounted receiver keeps all quoted-fence/JSON/Markdown/mmd tuples, current-observer/no-restart, nested Source Prism work, same named refusal, original wrapper identities and failure-safe joins; controlled frame responses prove abort requests and ignored-abort same-key stale suppression. Real parsing/math/SVG moves to the installed browser, while default transport/controller tests cover disposal/admission. Actual Prism imports and realm-before-restore joins remain.

The file-edit v5 receipts' single post-hide preview-instance assertion is replaced by native frame destruction and recreated-document assertions under v6 IDs, preserving foreground layout/input/scroll, all desktop/touch inputs, source/download, editing and uploads. Old receipt IDs refuse before execution. The additive browser-memory receipt changes no original Markdown chain.

The full-check source guard at `hooks/useAgentSession.test.mjs:77-92` originally required the exact two-field `force`/`fresh` options type. Confirmed-idle recovery adds one explicit boolean; the type predicate now names all three fields. Its force-query, wrapper-rebuild, mount-only force count and ordinary-load assertions are unchanged. All 23 cases pass in the focused rerun. The first full run stopped at this shape assertion after 294 core files passed; its coordinator interrupted browser peers and did not reach deployment. It is retained failure evidence, not full acceptance or an application-runtime counterexample.

## Checkpoint evidence

Focused pre-disposal checks passed eight files / 96 tests, including file lifetimes and initial chat policy. The subsequent chat/controller checkpoint passed six files / 66 tests. The first file-slice static check exposed an overbroad React media `src` union; the actual string assignment is now type-narrowed and the original failure log retained. The settled broad focused selection then passed 15 files / 168 tests; two final review repairs have a narrower follow-up running. Packaged Markdown passed all three current receipts, including three scrollback/return cycles, 16 unique block diagrams with destroyed frame/execution contexts and six executable-preview hide/show cycles. Both desktop/touch file-edit receipts passed. Initial test-only failures (ambiguous inner/outer entry selectors, extensionless Jiti transport alias, direct Node loading after a new extensionless runtime import, and geometry that never actually detached) remain retained; fixes target those premises rather than extending deadlines. These are still focused results, not full acceptance.

Independent review found and drove fixes for canonical gap recovery/cursor boundaries/idle optimistic reconciliation, and stale or uncertain file baselines. Code now protects that uncertainty through subsequent edits. Diagram review found no blocking issue, with same-origin trust, bounded failure behavior, fixed measurement viewport and GC/CPU limits documented. The final narrow source reviews confirm that all identified blockers are addressed. The five-file follow-up passed 57 tests. Lifecycle and review-fault controls failed only their expected named assertions after fixture corrections; application files were restored byte-identically. Full fresh acceptance remains the completion gate.

## Completion Checklist

- [x] Changed owners have meaningful regressions and retained runtime counterexamples. Three lifecycle faults caused the six expected named failures across 43 tests; two repaired review faults caused exactly their two named failures across 29 tests. All production files were restored byte-identically before positive verification.
- [ ] Repeated-use installed-browser checks establish bounded retained owners/resources, with honest distinction from GC/RSS attribution.
- [ ] Full Nix acceptance and independent review pass against the exact application/test inputs; record command/runtime/admission and evidence.
- [ ] Durable behavior and limitations are in owning guides; plan is archived and candidate is ready for the separately approved Git lifecycle.
