# Source and fenced-code highlighting

## Goal

Correct source grammars and defer Prism initialization/completed-fence highlighting without changing file contents, source coordinates, streaming, immutable Git review or the pinned toolchain.

## Context and decisions

- User authorized implementation after a read-only comparison of local `1fe0a04` and cached upstream `7c0778a8`.
- Adapt `898eb5ae` (grammars), `046bc67e` (lazy grammar loading) and only highlighting from `b2b6a45b` (deferred fences).
- User chose **no gutter changes** and **demo parity**. Inline media/tool arguments are separate tasks.
- Feature branch `feat/source-highlighting`, linked worktree `source-highlighting`, starts at local `rst-main` `1fe0a04c2d6d11e0c301457e379289d3a61f1508`.
- One repository writer/test coordinator; independent read-only safety review.
- No new library is planned: use the existing locked react-syntax-highlighter 16.1.2 package's lazy Prism entry, rather than introducing a parser or a direct transitive dependency. Keep manifests/locks/Nix pins unchanged.

## Architecture

- Deep-import core PrismLight and source node rendering. Demand-load the existing package's full Prism entry to register grammars into the same refractor core.
- Shared state contains only import promise/readiness, not user content or token trees. Failed imports remain plain and later demand can retry.
- First server/client render is deterministically plain. Only effects start loading and schedule completed-fence work; no render-time global budget mutations or server timers.
- Completed fences receive one asynchronous highlight grant per idle slice, with cancellable handles and newest-biased bounded fairness. Code/language/streaming identity invalidates stale grants. This does not subdivide a single tokenization or create a worker.
- Files load grammars only for the active bounded highlighted Source view. Preserve the >1,000-line fallback, chunking, row attributes/selection, drafts and CSV/TSV source overrides.
- Pierre rendering, immutable context, comparison-local review state and workers/caches are untouched. No content persistence/global token cache.

## Plan

- [x] Correct route/demo extension maps and add route/tokenization tests, including JSX/TSX, preview semantics and ambiguous names.
- [x] Add lazy loader/hook and switch runtime deep imports; prove same-core registration, deduplication, failures and deterministic plain SSR.
- [x] Add owned deferred-fence queue/hook with cancellation, fairness and generation tests; preserve plain live streaming and copy behavior.
- [x] Keep demo helpers/components in sync without a demo build or dependency installation; byte-parity inspection verifies the four helpers, MermaidBlock and extension maps. Root acceptance does not independently compile the demo.
- [x] Extend real Markdown browser coverage for lazy loading, delayed colors, source navigation/selection/layout, streaming transitions and failure fallback.
- [x] Update maintained feature/session/dependency guides; resolve independent safety review.
- [ ] Run focused Nix core/browser checks, then stable-candidate complete `all --workers 4 --jobs 4` after resource admission; record input identities, failures, runtime intervals and artifacts.
- [ ] Commit coherent reviewed changes and hand off exact candidate to the Git lifecycle's completion question/non-FF integration approval. No remote publication or host deployment.

## Risks and verification

Dynamic chunks must share PrismLight's core. A failed/unknown grammar must retain escaped text. Plain-to-colored transitions must preserve source rows, selection, reading position and dimensions. No speedup claim follows from source shape; acceptance is correctness evidence, not a benchmark. Existing SSR token tests need explicit loaded-versus-initial behavior rather than weakened assertions. Root acceptance does not automatically compile the independent static demo.

## Iteration evidence

- Focused core command selects `app/api/files/language-route.test.mjs`, `lib/prism-languages.test.mjs`, `lib/highlight-queue.test.mjs`, `hooks/highlighting.test.mjs`, `components/MermaidBlock.test.mjs`, `components/FileViewer.test.mjs` and `components/FileViewer.state.test.mjs` through `nix run .#test -- core`.
- Initial four-worker focused core: 116s command wall time, six files passed; the remaining test incorrectly required an exact class list. Actual JSX tokens included additional classes. Corrected to assert class membership, not exact serialization. Evidence `/tmp/pi-web-highlighting-core.KuEGGH.log`, `/tmp/pi-web-test-core.9B79U6/run.json`.
- Next two-worker focused core stopped during inner source export before static/tests: `Source identity/mode changed before reading: app/favicon.ico`. Evidence `/tmp/pi-web-highlighting-focused.4OI94V/core.log`, `/tmp/pi-web-test-core.cPr5ux/run.json`, 12s. No highlighting failure or harness fix is claimed; cause remains unestablished.
- Reviewed two-worker focused core passed **7 files / 36 tests**, static preparation included, **147s command wall time**: `/tmp/pi-web-highlighting-review.ZYjrmd/core.log`, `/tmp/pi-web-test-core.fmNYJi/run.json`. Two pre-existing ReviewFileBrowser ref-cleanup warnings remain; the new unnecessary-memo-dependencies warning was corrected. A subsequent scheduler idle/timer regression remains for complete acceptance.
- Independent review corrected selection-release batching: blocked fences now requeue when selection clears, preserving slice pacing. A deterministic two-consumer regression covers it. The queue carries no source strings in its generation tokens.
- Packaged browser iterations retained: `/tmp/pi-web-highlighting-focused.4OI94V/markdown.log` (187s, new fixture session IDs missing from the exact seeded-session inventory); `/tmp/pi-web-highlighting-markdown.N3sAdn.log` (19s, request observation preceded route admission); `/tmp/pi-web-highlighting-review.ZYjrmd/markdown.log` (outer tool interrupted at 300s; the owned builder subsequently settled with failure, immutable diagnostics `/nix/store/s07z9vhix997aaa7jnvb2myzmgkjl9iz-pi-web-browser-markdown-diagnostics`); `/tmp/pi-web-highlighting-browser.7qwtUn/markdown.log` (53s); `/tmp/pi-web-highlighting-browser.yzT5RY/markdown.log` (48s). None are acceptance passes or performance comparisons.
- Exact browser trace review corroborated that the real service worker bypassed page interception; added highlighting/failure fixtures now use separate service-worker-blocked contexts, leaving baseline Markdown context unchanged. Theme rendering consumes styled tag/attr-name classes; the surviving JSX `attr-equals` token is the browser assertion target, as observed in the retained trace. No console/HTTP exemption, original assertion/deadline removal or retry automation was added.
- Further retained browser iterations: `/tmp/pi-web-highlighting-browser.cJwRLF/markdown.log` (48s, sidebar center click hit hover actions; use the established row-edge click); `/tmp/pi-web-highlighting-browser.ee622P/markdown.log` (26s, all new desktop assertions passed but an unsuppressed context 409 exposed removal of a still-owned synthetic ancestor); `/tmp/pi-web-highlighting-browser.uqd9Md/markdown.log` (92s, desktop including original scenarios passed, but mobile does not mount an off-pane chat fence while Files is active); `/tmp/pi-web-highlighting-browser.4bDGqa/markdown.log` (61s, mobile canonical-history replacement canceled the transient message-end idle owner between observation and grant).
- **Readiness-probe correction:** the initial separate-fence import proof was desktop-only. The final fixture instead joins real `load` events on the exact held lazy script elements (execution, not merely response completion), then import microtasks/paint, and requires actual JSX tokens after selection clears. Independent read-only follow-ups found no blocker in selection-pacing, ownership or execution-barrier corrections.
- **Streaming-fixture scope correction:** `/tmp/pi-web-highlighting-browser.mcPMoq/markdown.log` (61s) proved an SDK wrapper could retain its canonical cached head after an ad-hoc fixture-file rewrite. The final test does not rewrite an SDK-owned session or invent saved entry IDs: it proves live plaintext and `message_end` deferred colors before emitting `agent_settled`, which independently reconciles actual history. Durable/provider replay is unchanged and remains covered by the existing history suite. The final fixture performs no session writes after seeding.
- Focused packaged `nix run .#test -- e2e --group markdown` **passed** desktop/mobile added highlighting/failure/streaming assertions and all original Markdown scenarios in **111s command wall time**, including realization; inner capsule **99.528s**. Evidence `/tmp/pi-web-highlighting-browser.TLU2zG/markdown.log`, `/tmp/pi-web-test-browser.kC32Cn/run.json`, snapshot `/tmp/pi-web-test-source-HuM6pi`, outer content/mode digest `95a5d9d48026fe4d9bd7a74aed7566c0d9e62c06ab5266706a05176468a6133c`. Prerequisites were warm from retained iterations; this is focused correctness evidence, not full acceptance or a performance benchmark.

## Completion Checklist

- [ ] Correct grammars and demand/deferred loading verified, with no new library or toolchain changes.
- [ ] Existing streaming, source navigation, editing, Markdown and immutable Git contracts remain accepted.
- [ ] Independent review resolved and complete acceptance evidence retained.
- [ ] Lifecycle status and known gaps reported honestly; integration/cleanup remain separately gated.
