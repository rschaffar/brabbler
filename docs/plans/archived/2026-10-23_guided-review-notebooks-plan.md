# Guided review notebooks

## Goal

Deliver an agent-authored notebook folder with chapter-based guided reading and a
complete persistent interactive review loop: recorded answers, explicit progress,
anchored feedback, selected batch handoff, per-item replies and re-review history.

**Disposition (2026-10-27): implemented and fully acceptance-verified.** The reader
was integrated earlier. The complete interactive composition passed at
`bda3cf5cf7cb1973471c4864d5518405cd6d7604`, based on local main
`9b8f024280efb0dff9313c3d770ba9d0651e12dc`. This archive transfers no product work
to another increment. The final documentation-only closure does not relabel earlier
tests as a run on its newer tip.

**Authority:** the user approved rough sample/desktop/mobile interaction direction,
not pixel-perfect drawings, then authorized implementation and architectural
refactoring. The later request was to implement the **full plan until done**. The
intermediate reader-only user-validation stop was explicitly superseded; automated
browser evidence below is not invented hands-on user validation. External session
launches, other projects' notebook migrations, publication and host-service deployment
remain outside this task.

## Maintained ownership and accepted boundaries

- [Notebook authoring and recording contract](../../review-notebooks.md) owns the
  strict `pi-notebook` / `pi-step` / `pi-evidence` / `pi-question` format, supported
  renderers, limits, sidecar and reply schemas, recovery and invalidation semantics.
- [ADR 0029](../../adr/0029-markdown-review-notebooks.md) and
  [ADR 0036](../../adr/0036-guided-review-recording.md) own accepted decisions.
  [Architecture](../../architecture.md), [feature contracts](../../feature-internals.md),
  [questions](../../questions.md), [session contracts](../../session-internals.md)
  and [test writing](../../test-writing.md) document their shared-owner integration.
- Notebook folders keep Markdown chapters/assets separate from review-data sidecars.
  Contextual creation briefing uses existing `ask_user`, not a new creation wizard.
  Parked authoring-packaging/prompt work remains with its separate existing owner;
  it is not a missing interactive-workflow package.
- Desktop outline/explanation/evidence and optional paired targets become stacked
  evidence on mobile. Back/Next, chapter jumps and exploration stay free. **Next
  never means approved**. Evidence viewing/forms do not implicitly mark Reviewed.
- Text/single/multiple questions reuse shared field presentation, not blocking live
  question request/receipt semantics. Required current-version outcomes gate only
  Reviewed; answer, unsure, not-applicable and skip remain distinct recorded choices.
- Not reviewed / In progress / Needs attention / Reviewed are explicit reviewer
  choices. Progress and open concerns are independent. Questions/findings/guide issues
  use step, target or supported immutable source/diff/text anchors; no guessed
  image-region or native-PDF text coordinates. Resolution/reopening is reviewer-owned.
- Batches freeze selected item/material versions. Exact destination/content preview
  precedes appending to the existing chat draft; ordinary Send is a second explicit
  action. No automatic prompt, session creation, fixes, tests, Git or publication.
  Validated raw-file or pasted JSON imports retain exact reply bytes and per-item
  history; replies never resolve concerns automatically.
- Explicit recording uses independently authorized fixed working-tree sidecars;
  GET/open creates nothing. Expected-tip numbered snapshots, flushed private stages,
  exclusive installation and recoverable conflicts/ambiguous outcomes avoid silent
  overwrites. This is single-reviewer conflict detection, not live collaboration or
  strict exclusion/cryptographic provenance against arbitrary external editors.
- Material fingerprints bind effective guide/questions, pinned evidence and actual
  displayed mutable bytes. Branch advance, chapter reorder and sidecar changes do
  not invalidate unchanged evidence. Missing authority is unavailable, not fabricated
  change. Deleted/stale records stay recoverable; no silent anchor rebasing.
- Shared source/diff readers, toolbar/model, Markdown/native-document presenters,
  question fields and existing composer remain owners. Ordinary preview/live-question
  defaults are preserved. New test files retain justified E holds, not omitted coverage.

The [rough design specimen](../assets/guided-review-notebooks/design.md) and sample
folder preserve the approved direction. Detailed superseded plan text is retained
in Git through `bda3cf5`; raw workflow corrections and failed runs live in the
[workflow evidence ledger](../assets/guided-review-notebooks/workflow-evidence.md).

## Plan

- [x] Resolve parsing, bounded independent read/write authority, immutable comparison,
  persistence/recovery, question/state/history and explicit handoff boundaries.
- [x] Implement and integrate the usable reader with free chapter navigation, paired
  evidence, independently authorized repositories and supported non-code formats.
- [x] Implement the complete recorded review loop, shared-component refactors and
  maintained documentation/ADR; no deferred interactive feature scope remains.
- [x] Cover actual parser/reducer/native security and concurrency, mounted lifecycle,
  malformed recovery, actual displayed bytes/selections and installed desktop/touch
  composition. Meaningful production defect controls fail and are restored.
- [x] Obtain independent storage/UI delta reviews and fix their material findings.
  Final narrowed reviews found none. Diagnose and repair the composed shared-reader
  regression with unchanged mounted/browser assertions, not an unexplained retry.
- [x] Pass focused checks followed by complete current-main Nix acceptance below.
- [x] Curate/archive this execution plan; move current behavior/decisions to maintained
  owners and explicitly hand local Git disposition to the receiving session's gated
  operation receipts, rather than keeping a false product-work queue.

## Complete workflow acceptance

- Tested commit: **`bda3cf5cf7cb1973471c4864d5518405cd6d7604`**, on main
  **`9b8f024280efb0dff9313c3d770ba9d0651e12dc`**.
- Command: `nix run .#test -- all --workers 4 --jobs 4`, **exit 0**, **585s**
  end-to-end including in-run realization. No separate prewarming; model/review time
  excluded. This is not a cold-cache promise or benchmark comparison.
- Requested/effective **4 core workers / 4 browser sandboxes**, overlapping. The
  12/4 profile was deliberately not added to observed concurrent CPU-heavy work
  (multiple processes above 100% CPU, load 18.79 at the first admission; still busy
  at corrected admission). Corrected selection observed 32 CPUs / 54,242,037,760
  available bytes; estimated overlap required 16 CPUs / 28,991,029,248 bytes.
  These estimates are not machine-wide reservations. Deadlines were not enlarged.
- **522/522 core files, 4,285/4,285 tests, 14 suites**, no skips/cancellations;
  static checks **0 errors / 7 pre-existing warnings** and plugin checks pass.
- **26/26 browser/terminal groups, all 59 expected scenario receipts** pass,
  including full installed Markdown workflow at both desktop/touch widths and the
  ordinary Git-card full-context jump that caught the composed regression.
- Genuine Home Manager deployment NixOS VM passes activation, environment/access,
  HTTP write, restart persistence and production PTY; guest service/processes settle.
  No installed host service is used or changed.
- Source snapshot: `/tmp/pi-web-test-source-Gy1ZcG/source`, SHA-256
  **`5eb83eed2a9cc8cc7b74b9a962a5c549bc12914d814ee0a397821095d46d91c2`**;
  admission/selection: `/tmp/pi-web-test-source-Gy1ZcG/selection.json`.
- Command log: `/tmp/guided-workflow-corrected-all.SRN5W0.log`.
  Core: `/tmp/pi-web-test-core.fHK9Jm/run.json`, immutable diagnostics
  `/nix/store/7wv0scbk8rdbi4nfrx4mj06daxznq877-pi-web-core-checks`.
  Browser: `/tmp/pi-web-test-browser.iQnhk3/run.json`.
  Deployment: `/tmp/pwv-v7dIYt/run.json`.
- Separately observed intervals: core preparation to first file **51.359s**, core
  file-execution window **514.820s**; browser support **115.001s**, manifest
  **6.738s**, group-execution window **373.475s**; VM command envelope **82.181s**,
  VM script **22.51s**. Overlapping intervals must not be summed as serial time.

The earlier composed candidate `8c88cbf` **failed** ordinary Git-card line-2500
navigation in both mounted and browser runs; Markdown was interrupted, not passed.
Independent unchanged-source reproduction and main comparison identified a memo
that tracked stable model identity but lost mutable `context`/`full` dependencies.
Explicit current-field snapshots restore invalidation without suppressing lint,
changing fixtures/assertions or increasing deadlines. Four focused files / 27 tests
passed before the final complete run. Full failure, focused, earlier 16-file/82-test,
installed workflow and restored defect-control evidence remain in the ledger.

## Complete reader acceptance

Historical reader-only complete acceptance ran at
`532a17656be3f38c06dc19c774a206b6d4eadac8` with
`nix run .#test -- all --workers 4 --jobs 12`: **393s**, **516 files / 4,243 tests /
14 suites**, **26 browser/terminal groups / 59 receipts**, deployment VM. Source
SHA-256 `a347597642b33b93da61d26d00182e948c75a0dcb71bc6e9ee0853988edce5ac`;
`/tmp/guided-reader-composed-all.ZSqi9O.log`, `/tmp/pi-web-test-core.ePKx16/run.json`,
`/tmp/pi-web-test-browser.cLZIMq/run.json`, `/tmp/pwv-a1eQTs/run.json`.
It was integrated as `74c4fdaf659df2509a8ee3a452a82edaf3d5ff51`. It was not full
interactive acceptance. Original timing details remain in the pre-curation plan
history; the later workflow result above is separately input-bound.

## Git handoff and recovery

At archival, implementation and complete acceptance are finished; exact local
integration approval/execution/result verification and separately gated cleanup
belong to **the receiving session's Git operation receipts**, not another feature
increment. It must propose the final documentation tip against current local main,
use unsigned non-FF merge, reject stale state and verify exact parents/tree before
reporting integration. Rebase/relevant input changes require reassessment. This
archive is not approval, proof of integration, permission for remote operations,
or permission to remove unknown artifacts. Preserve feature resources if blocked.

No data migration or destructive history cleanup occurs on open. Malformed or
unknown sidecars remain intact with diagnostics; ambiguous writes require explicit
reload/reconciliation, not silent retry. Removing the UI leaves Markdown and local
review data intact. No external notebook migration, host rollout or publication is
left as an implicit requirement.

## Completion Checklist

- [x] Approved rough interaction, compatible strict authoring contract and shared
  reader/form/composer owners deliver both agreed increments.
- [x] Persistent answers, four states, anchored/versioned feedback, exact selected
  batches, per-item replies, reviewer resolution and dependency-based re-review work.
- [x] Adversarial read/write/session boundaries, concurrency/recovery and stale work
  have native/mounted coverage plus full installed composition; concerns, progress,
  explicit approval and test execution remain distinct.
- [x] Independent findings are resolved and complete current-main core/static/plugin,
  browser/terminal/deployment acceptance passes with exact input-bound evidence.
- [x] Maintained guides/ADRs own delivered behavior; only gated local Git disposition
  is handed to its explicit operation owner above. No other project is mutated.
