# Append-tail session-list scanning

## Goal

Port upstream append-tail metadata scanning while preserving this fork's archive, spawn, title, ordering, recovery and source/trust contracts. Implementation is authorized by the user in this session; remote actions, live-data/provider/service inspection and deployment remain excluded.

## Context

- Base/local `rst-main`: `1fe0a04c2d6d11e0c301457e379289d3a61f1508`.
- Worktree: `/home/robert/projects/3rdparty/pi-web-worktrees/session-append-tail`, branch `perf/session-append-tail`.
- Cached upstream: `/tmp/pi-web-upstream-review.KEkJjU/repo.git`, commit `1a94341cb2bdc9e152717f8514ccbc79171672f6`, unchanged scanner at cached tip `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`.
- The user explicitly chose sampled validation (including its unsampled historical-edit limitation) and preservation of current cold/deferred archive discovery. No full-prefix hashing or summary optimization.
- Retain SDK 1.3.0, Node 24.21.0, Next 16.4.2 and immutable Nix packaging.

## Plan Relationship

The archived 2026-10-20 easy-wins, security and followups batches remain complete; none owns this optimization. Maintained session contracts own ongoing behavior. The global Git lifecycle owns exact-state integration into local `rst-main` by unsigned non-FF merge and separately approved cleanup. Parent is the sole writer/test coordinator; independent safety review is read-only.

## Plan

- [x] Adapt the byte-oriented parser and metadata accumulator; retain archive latest-valid-marker and spawn first-validated-marker semantics.
- [x] Add sampled resume checkpoints, conservative rewrite/replacement/truncation fallback, bounded persisted-state validation, scan ownership and private coalesced persistence.
- [x] Extend synthetic scanner/spawn tests for offsets, metadata, partial records, Unicode/CRLF, replacement, persistence and controlled races; update the synthetic benchmark.
- [x] Update `docs/session-internals.md`, obtain independent review and resolve findings.
- [ ] Run focused Nix core/static checks, then fresh full core/browser/terminal/deployment acceptance after source settlement; record exact identities, commands, timing, outcomes and artifacts.
- [ ] Commit coherent reviewed changes, reassess/rebase current `rst-main`, and hand the exact candidate to the Git lifecycle for completion intent and exact-state approval. No publication/deployment implied.

## Risks and Recovery

Sampling is not integrity verification: same-inode historical edits outside header/boundary followed by growth can retain stale metadata. Cold summaries retain transcript-wide archive reads. The index is disposable versioned metadata, not authority or session data; invalidation/lost pending writes cause rescans. Full rewrites, move/reparent operations and concurrent external writers remain supported conservatively, not transactional snapshots. Rollback reverts code and rebuilds the disposable index; never rewrites or deletes transcripts.

## Focused evidence and review

- First focused five-file command was interrupted by the outer 120-second tool budget, leaving its exact Nix builder alive. Static/typegen/typecheck/lint and the existing scanner file had passed; the new tail file was stuck on an untriggered synthetic gate. The exact owned builder was stopped with SIGINT and its recorded PIDs were verified absent. No complete acceptance is claimed. Evidence: `/tmp/pi-web-append-tail-focused.wPYl79.log`, `/tmp/pi-web-test-core.itOx9k/driver.log`, snapshot `/tmp/pi-web-test-source-d4XYgT` (`6b1ada8fe366725f9d3db28091a09f3a6382d63f21ec02d9d5b535aa8b69b70e`). No failed artifacts were deleted or permissions broadened.
- A bounded new-test gate exposed the fixture cause: Jiti caches named builtin property values on first access, so installing interception after an initial scan did not observe or inject reads. The completed failing one-file command took **72 seconds**, `/tmp/pi-web-append-tail-tailtests.thROns.log`, `/tmp/pi-web-test-core.nHBYHo/run.json`; it honestly reports 11 failures/1 cancellation, not application correctness failures from successfully injected races.
- Independent safety review identified numeric-descriptor double-close risk on early stream exit. Streams now share FileHandle ownership and close it through normal/error/early-return lifecycle; finally is idempotent. Pool owners await all workers before propagating failure. Documentation qualifies inherited nontransactional summary reads.
- Dynamic `fs.createReadStream` module access fixes interception without a production test-only seam. New cases have bounded ten-second gates; no existing test/browser deadline was increased. One-file fresh Nix core/static passed **15 tests** in **85 seconds command wall time**, `/tmp/pi-web-append-tail-mockfix.1A0J4V.log`, `/tmp/pi-web-test-core.bS2tb7/run.json`.
- Broader `nix run .#test -- core --jobs 4 --file lib/session-list-scanner.test.mjs --file lib/session-list-scanner-tail.test.mjs --file lib/session-spawn.test.mjs --file lib/session-reader.test.mjs --file app/api/sessions/runtime-route.test.mjs` passed **5 files / 69 tests**, static/typegen/typecheck/lint included, **181 seconds end-to-end command wall time**, including realization and concurrent machine load. Evidence `/tmp/pi-web-append-tail-focused-final.FXGrvN.log`, `/tmp/pi-web-test-core.afpJxg/run.json`, snapshot `/tmp/pi-web-test-source-gkeeR2`, outer digest `c96939c6f7b8490b653e95a402c9b08aaaccab81c855cb559cdcadc90b9001dd`. These are focused checks, not complete acceptance or a performance benchmark. Existing unrelated ref-cleanup lint warnings remain warnings.
- Final independent read-only review found no scoped blockers after the corrections. The benchmark was updated but not executed; no measured speedup is claimed.

## Completion Checklist

- [ ] Fork metadata and listing contracts are preserved with meaningful synthetic regressions and independent review.
- [ ] Complete required Nix acceptance passes for the settled candidate; failed or unavailable evidence is explicit.
- [ ] Durable contracts and evidence are recorded, with exact feature/integration state and separately gated cleanup reported honestly.
