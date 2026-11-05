# Retired notebook recording: recovery and assertion disposition

[ADR 0041](adr/0041-guided-reading-and-notebook-authoring.md) replaces notebook
recording with guided reading and ordinary conversation. This is separate from
Git-operation reviews, live `ask_user` questions and their receipts.

## Recover existing data manually

No notebook history or browser recovery data is automatically opened, rewritten,
converted or deleted by the new reader. `/api/review-data` GET/POST returns HTTP 410
for admitted requests without reading the path, request body or stored history.
The absence of the old controls does not mean saved data was removed.

### Saved local files

Look beside the notebook's `index.md` for the existing `review-data/` directory:

```text
review-data/
  reviewer/0000000001.json
  reviewer/0000000002.json
  replies/<batch-id>.json
  imported-replies/<batch-id>-<sha256>.json
```

Copy that complete directory to a private backup before manual investigation. The
numbered reviewer files are complete historical snapshots with consecutive sequence
numbers and previous-file hashes; imported replies are original saved bytes. Keep
the originals, even if malformed. Do not edit hashes, renumber files or rewrite
anchors to make historical answers look current. Ordinary file access permissions
still apply; recording retirement does not grant additional access.

These files can contain private reviewer responses. Do not paste them into a public
issue or commit them as examples. They do not preserve missing Git objects, prove
that current prose was reviewed, or reconstruct an older notebook automatically.
There is no new migration or historical-record-management UI.

### Unsaved browser drafts

In the browser profile/origin where the old reader was used, open developer tools
and locate **Application/Storage → Local Storage**. Preserve the literal values of
keys beginning with `brabbler-notebook-review-draft-v2:` or the earlier
`brabbler-notebook-review-draft-v1:`. The v1 suffix is the raw notebook index path;
v2 URL-encodes that path and adds the file-view owner. Copy the relevant values verbatim into
private text files, including malformed values. Do not clear storage or overwrite
another pane's record to recover it. No script execution is needed.

Browser clearing/profile removal can already have lost these entries; server
history is not a backup of unsaved browser drafts. Preserving keys is not
cross-device synchronization. New guided reading does not create such entries.

For source-level recovery, base commit
`14d60757535e0ed78ff3753fda1372b0e4c47bbb` contains the retired implementation and
[ADR 0036](adr/0036-guided-review-recording.md) records its old protocol. Running an
older version or restoring a service is a separate deliberate operation, not an
automatic fallback. Work from copies rather than modifying originals blindly.

## P1 assertion dispositions

Original coordinates below refer to base commit `14d60757535e0ed78ff3753fda1372b0e4c47bbb`.
Replacement assertions are implementation owners, not a claim that verification
has passed; candidate-specific results belong in the
[active plan](plans/2026-11-05_notebook-authoring-plan.md).

| Original owner / coordinates | Disposition and surviving obligation |
| --- | --- |
| `lib/notebook-review.test.mjs:13–46` | Retire outcome gates, fingerprints, batches, imported replies and reviewer resolution: those operations no longer exist. Ordinary live required-answer validation remains in `lib/question-set.test.mjs` and the explicit legacy-adapter assertion now in `lib/guided-review.test.mjs`. |
| `lib/notebook-review.test.mjs:47–66` | Move strict legacy-question parsing, explanation preservation, duplicate-property refusal and leading underscore/hyphen question/option IDs to `lib/guided-review.test.mjs`; retire recorded-outcome/review-mark assertions only. |
| `lib/notebook-review.test.mjs:67–78` | Retire writable browser draft/reply schema. The reader no longer consumes it. `GuidedReviewReader.behavior.test.mjs` preserves both ordinary and malformed retained entries without applying them. |
| `lib/notebook-review.test.mjs:79–87` | Keep current/switched/missing/unmounted destination refusal and append-at-end under actual `ChatInput.review-handoff.test.mjs`; new reader tests prove step context/currentness. |
| `lib/notebook-review-store.test.mjs:21–228` and its writer fixture | Retire history append/import, inspection aggregation, fsync/link/CAS/replay/recording races with the removed store. The replacement API tests forbid filesystem access/body consumption and preserve a malformed sidecar sentinel. Guided package/asset authorization and immutable Git reads remain in their existing notebook API/source/native owners, not replaced by a synthetic 410 test. |
| `app/api/review-data/route.test.mjs:24–53` | Retire recording-body/schema/physical-write gates because all admitted GET/POST requests now return 410 without reading body/storage. Retain cross-origin refusal and add native no-filesystem/no-body/preserved-sidecar proofs. |
| `components/NotebookReviewPanel.behavior.test.mjs:98–148,194–277` | Retire forms, saved outcomes, recording conflicts, draft classification, per-pane radio/recovery/import/resolve behavior. New reader mounts preserve valid and malformed old recovery bytes with guarded key access and prove there is no form/recording transport. Restricted question-context image/card suppression and fenced-code readability (`105–106`) survive on actual passive guidance; these are not retired with the forms. The composer attachment/selection/no-Send bridge remains mounted separately. |
| `components/NotebookReviewPanel.behavior.test.mjs:149–193` (`asset-first`, `inspect-first`) | Retire A-display/B-inspection recording eligibility and feedback-coordinate rebinding: no inspection/recording/feedback exists. Existing production reader tests retain actual immutable/mutable body identity, ignored-abort success/error, fresh reads and unmount. Shared Pierre public-selection behavior remains in `CommittedPatchDiff.test.mjs`. |
| `e2e/guided-review-workflow.mjs:8–128`, both original desktop/touch inputs | Replace only the recording tail (enable/outcomes/mark, source-anchor finding, cross-chapter batch, draft/import/resolve, saved resume and re-review). Keep every preceding read-only notebook/layout assertion in `e2e/review-notebooks.mjs`. New tail proves passive legacy choices, free steps, current-step context in preserved ordinary draft, no agent execution, no review-data requests, explicit position-preserving reload, narrow controls and untouched malformed native/browser history. |

Rebase disposition at local-main input
`b5696cd4cfb935b9bdc3f8d7918bbd41da419286`: the added
`lib/notebook-review-store.test.mjs` case **“rename presentation leaves authored
old/new comparison material and saved answer fingerprints intact”** is also
retired with recording. Its saved-answer/question fingerprints and history
append/read assertions have no remaining runtime. Its immutable rename context
and authored delete/add comparison obligations survive in `lib/git-explorer.test.mjs`
(the commit rename matrix, including dirty working bytes and ambient rename
configuration) and `lib/git-file-context.test.mjs`. Their actual production-reader
assertions remain required; preserved old recording bytes are covered separately
by the retirement owners above. No rename-aware reader tests are deleted.

The changed Markdown chains use `render-files-native-v7@legacy-desktop` and
`render-touch-wiring-v6@legacy-mobile`. Prior v6/v5 IDs are rejected before callbacks;
dispatch, inventory and coverage tests change together. Other Markdown/media/skill/
model/source-link assertions and input variants are unchanged. HTTP observation
still allows only the exact existing-session catalogue and bodyless maintenance
lease tuples, not prompt/new-session/agent execution. No console/HTTP errors are
suppressed. Core/mounted tests do not prove native browser geometry or server
wiring; the installed chain remains required, followed by complete acceptance.
