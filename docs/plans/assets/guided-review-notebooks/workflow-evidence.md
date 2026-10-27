# Interactive workflow implementation evidence

This is raw focused-run chronology, not full acceptance or live-user validation.
Writer: `guided-review-workflow`, branch `feat/guided-review-workflow`, based on
`74c4fdaf659df2509a8ee3a452a82edaf3d5ff51`. No Git lifecycle, host-service access,
development server, checkout production build or browser/full-all execution by the
writer. Parent owns final review, installed bridge and complete acceptance.

Every execution below used `nix run .#test -- core --jobs 4 --file …`, with exact
selections/source bindings in the retained log and associated run report. No retry,
deadline inflation, console/5xx suppression, skipped test or browser retirement was
used. Source writing paused for exports. Static outputs are separately keyed and
may be reused only for matching inputs. Command/phase times are not model work.

## Iteration history

- `/tmp/guided-workflow-first-focused.log`: initial model/store, 2 files / 10 cases
  passed. `/tmp/pi-web-test-core.Y1dbWt/run.json`. Earlier source, not final evidence.
- `/tmp/guided-workflow-mounted-focused.log`: shared live dialog, reader and panel
  passed; native race assertion expected the wrong conflict wording. Failed run
  retained at `/tmp/pi-web-test-core.hjbmU5/run.json`; model selection not started.
  Production conflict wording was made explicit, not weakened into success.
- `/tmp/guided-workflow-core-v3.log`: 6 files / 21 cases passed, static 0 errors /
  7 pre-existing warnings; `/tmp/pi-web-test-core.TbNDoB/run.json`.
- `/tmp/guided-workflow-composed-focused.log`: new range fixture incorrectly used
  CodeView's silent coordinator-clear setter as if it emitted a renderer callback.
  Corrected to the actual public rendered FileDiff selection setter. This was a
  fixture-contract failure, not a meaningful production defect control.
- `/tmp/guided-workflow-composer-range.log` and
  `/tmp/guided-workflow-range-diagnostic.log`: the held context fixture omitted
  required cache keys. The existing live collector correctly failed teardown on
  the original validation error. Added bounded nested diagnostics, corrected
  fixture identities and asserted actual context publication. No error suppressed.
- `/tmp/guided-workflow-review-fixes.log`: static-only failure for an unescaped JSX
  apostrophe; `/tmp/pi-web-test-core.PvcxLB/run.json`. Not runtime evidence.
- `/tmp/guided-workflow-review-fixes-v2.log`: **8 files / 51 cases passed**, including
  native API/store, mounted default forms/Pierre/composer, strict reducer/recovery,
  review snapshot orders and reviewed safety fixes. Static 0 errors / 7 pre-existing
  warnings. `/tmp/pi-web-test-core.8k4F8G/run.json`, 46.991s core-driver envelope
  including in-run static/realization. Immutable export
  `/tmp/pi-web-test-source-jgEJlx/source`, outer SHA-256
  `3bcb8de39decca1e577f747ff34b47891746f162413a222a7f51f9a22fd7bff1`.
  Later source/doc changes require the final composed focused run, not relabelling
  this result as their execution.

- `/tmp/guided-workflow-final-focused.log`: first expanded 15-file selection failed
  an existing guided-parser diagnostic assertion (`16,384 bytes` vs the newly
  generalized helper's unformatted number); 5 files passed and 9 were not started.
  `/tmp/pi-web-test-core.HddjeZ/run.json`, 43s command. Restored the original default
  metadata diagnostic in production; did not weaken/retire the old assertion.

## Meaningful actual-production controls (all faults restored)

- **Exclusive numbered-slot installation**: replace the real exclusive link with
  overwrite-capable rename. Both actual processes reached the named same-tip,
  staged/fsynced before-install gate. The exact loser Conflict assertion failed
  (post-install ambiguity instead of exclusive-slot refusal). Native first-file
  bytes and the real process originals remained owned. Log
  `/tmp/guided-workflow-exclusive-install-red.log`, report
  `/tmp/pi-web-test-core.Xr3KzV/run.json` (8 pass / 1 fail).
- **Required recorded outcomes**: change the actual reducer's Reviewed gate to
  Not reviewed. Actual model assertion fails with missing expected rejection:
  `/tmp/guided-workflow-required-outcome-red.log`,
  `/tmp/pi-web-test-core.zgCDPT/run.json` (5 pass / 1 fail).
- **Displayed mutable byte binding**: remove `displayBytesMatch` from the real
  recording gate. Both actual GuidedReviewReader/FileEvidence response-order
  cases fail the disabled-Reviewed assertion for displayed A vs inspected B:
  `/tmp/guided-workflow-displayed-snapshot-red.log`,
  `/tmp/pi-web-test-core.aM6iT1/run.json` (9 pass / 2 fail).
- **Composer preservation**: ignore the new at-end insertion option. The actual
  mounted composer replaces the old native selection; its unchanged-draft-prefix
  assertion fails, not an import/type/setup assertion:
  `/tmp/guided-workflow-composer-preservation-red.log`,
  `/tmp/pi-web-test-core.zCKndd/run.json` (0 pass / 1 fail).
- **Obsolete selection failure publication**: remove the real catch's mounted/
  mode/generation guard. Both held obsolete success/abort and rejection cases
  publish old owner A after selected B, failing exact owner-B assertions:
  `/tmp/guided-workflow-stale-selection-red.log`,
  `/tmp/pi-web-test-core.n3uI2A/run.json` (11 pass / 3 fail including parent subtest).

The required/display controls shared one source snapshot with two isolated faults
and ran as independent focused invocations. The composer/selection pair did likewise.
Their state domains are independent; neither failure is a compile/setup failure or
another fault's assertion. Native install control ran separately. These controls
prove bounded named obligations, not hostile external-editor transactions or every
browser/device/filesystem combination.

## Earlier thNSFa composed focused pass

`/tmp/guided-workflow-final-focused-v2.log`: **15 files / 79 tests passed**, static
0 errors / 7 pre-existing warnings, no skips/cancellations, four requested/effective
core workers. The log/run report owns the exact expanded selection, including shared
question defaults, existing reader/diff/presenter/workspace, bounded-body helper and
all new workflow owners. Native cases additionally cover genuine Git branch advance,
chapter reorder, sidecar/key-order fingerprint exclusions and a growing historical
file refused during its original bounded read.

- Whole command **149s** (whole-second wall clock), including realization; core
  driver **139.843s**, pre-first-file realization/static/setup **106.293s**, actual
  file execution window **33.350s**. No benchmark/cold-cache or universal closure claim.
- `/tmp/pi-web-test-core.GwfqPz/run.json`; immutable artifacts:
  `/nix/store/bzk9m6vwqfbvhd9mz51rndbq6p0mrs9q-pi-web-core-checks`.
- Tested export `/tmp/pi-web-test-source-thNSFa/source`, outer mode/content SHA-256
  `de957f9e4d81c3dd2e4f6c8b5a2950fe15ac3d9ca303cba123a8c3507a2fdfc6`.
- Application/test/bridge writing stopped after this pass. Following edits only
  record evidence/status in this document and the active plan. Final parent review
  and full acceptance remain required; no user runtime validation is fabricated.

## Post-thNSFa final review correction evidence

Parent found three further MEDIUM issues in the reviewed snapshot. Corrections
are deliberately narrow: all feedback versions/frozen records/stored replay enforce
that guidance-only anchors cannot be findings; displayed mutable generation/byte
changes invalidate current target text selection; explicit malformed-recovery
Discard validates/persists current fields before clearing its warning. Native and
actual mounted regressions preserve rejected-conversion bytes/tip, allow deleted-
anchor text edits, select A before changing displayed evidence to B, and remount
immediately after Discard without another edit. The Save gate mirrors the feedback
invariant for edits too; temporary incomplete local field combinations remain
recoverable (not reviewer operations), while editing records/pending operations and
stored snapshots keep strict validation.

- `/tmp/guided-workflow-final-review-regressions.log`: six exact selected files /
  **39 tests passed**, static 0 errors / 7 pre-existing warnings, **72s command**.
  `/tmp/pi-web-test-core.qaIp3e/run.json`, export
  `/tmp/pi-web-test-source-S6rDy9/source` (before the final query-negative and
  incomplete-field recovery/UI-gate adjustments; the final selection below owns
  those changes).
- `/tmp/guided-workflow-last-delta-native-red.log`: removing the all-version
  feedback invariant fails the actual native edit rejection (missing expected
  rejection); 11 pass / 1 fail. `/tmp/pi-web-test-core.xd98e7/run.json`.
- `/tmp/guided-workflow-last-delta-ui-red.log`: retaining old snapshot selections
  fails both response-order selection-invalidation assertions; reverting Discard
  to remove-only fails all three kept-field persistence assertions (null vs exact
  current text). 6 pass / 5 fail; `/tmp/pi-web-test-core.aXCPRV/run.json`.
  The independent isolated faults shared a source snapshot; all are restored.
  No type/setup failure is counted as these runtime controls.

Parent's first installed Markdown attempt is retained, not hidden by a retry:
`/tmp/guided-workflow-markdown.JJMF8P.log`,
`/tmp/pi-web-test-browser.7AdrGD/run.json`, capsule
`/nix/store/lpkfpry6s7bkgrq2smllh56644a9a4i7-pi-web-browser-markdown-diagnostics/artifacts`.
It failed the new blanket POST-count assertion (1 vs 0). Parent examined
`context-1.zip` trace.network and
`resources/2010b0b4468e5ff8a215109e2b366b044a2a0d4a.json`: the collected request was
exactly `POST /api/agent/e2e-review-notebook` with `{"type":"get_tools"}` from normal
existing UI focus/open, not an auto-prompt/agent-execution command. Prior other-
session catalogue reads preceded this workflow.

The corrected bridge records all observed agent method/path/query/body tuples,
keeps ordinary GETs in diagnostics, and permits only that exact existing-fixture-
session catalogue tuple among non-GET requests. It does not accept arbitrary read
commands, extra keys, other sessions, prompt/steer/Bash, new sessions or malformed
bodies, and never resets its observations after an action. Actual helper regressions
cover these negatives. Original native/read-only assertions remain before writes;
console/HTTP collectors are untouched. This is a test-scope correction, not product
behavior change or an installed rerun; parent owns the next browser execution.

## Final post-review focused pass

`/tmp/guided-workflow-post-review-final-focused.log`: **16 files / 82 tests passed**,
static 0 errors / 7 pre-existing warnings, no skips/cancellations, four requested and
effective core workers. The exact selection is in that log and the run report;
it adds the actual browser observation/helper contract file to the prior composed
workflow/default-owner selection. The new file retains an explicit conservative E
hold, not a scheduling promotion.

- **70s whole command** (whole-second wall clock), including in-run realization;
  driver **65.131s**, before-first-file realization/static/setup **41.724s**, file
  execution window **23.242s**. No separate prewarming or benchmark/cold-cache claim.
- `/tmp/pi-web-test-core.kIoCxM/run.json`; immutable output
  `/nix/store/v7qma0dd8p4q8zyrz8y5zby9h0gjd8vs-pi-web-core-checks`, including
  per-file TAP/errors, summary/lifecycle/static evidence and settled native results.
- Export `/tmp/pi-web-test-source-sgeNHO/source`, SHA-256
  `1b19c92c9ff46a91f6f3595bd0e123aed3443d84b04967f81c8d5301a44d5ca8`.
- Three latest production controls above are restored. Application/test/browser-
  bridge writing stopped after this pass; only final evidence/status prose follows.
  The writer did not rerun installed Markdown or any full-all/e2e/Git operation.
  Parent must rerun the retained failed installed bridge and final acceptance; this
  focused result does not close those gates or invent user runtime validation.

## Parent-owned installed bridge and current-main composition

The installed Markdown desktop/mobile bridge passed after the diagnosed catalogue-read
assertion correction: `/tmp/guided-workflow-markdown-fixed.i9cx5d.log`,
`/tmp/pi-web-test-browser.OaMXUZ/run.json`, immutable diagnostics
`/nix/store/ffkm83ddhxnsxrj2j3lz7bwm7vnzy5dg-pi-web-browser-markdown-diagnostics`.
Command wall **298s**, capsule **192.918s**. Existing chains/read-only assertions remain;
recording/forms/source Selection, cross-chapter batch draft, exact composer destination,
pasted replies, reviewer resolution, saved reload/resume and changed required questions
ran at both widths. This is automated installed-browser evidence, not invented user validation.

The feature was committed and cleanly rebased onto local main
`9b8f024280efb0dff9313c3d770ba9d0651e12dc`, producing candidate
`8c88cbf0dbb4b45a74c4efa11c59c859f7f85089`. Fresh full acceptance
`nix run .#test -- all --workers 4 --jobs 4` **failed**, command wall **381s**:
`/tmp/guided-workflow-all.Rro3MF.log`, core `/tmp/pi-web-test-core.JCuvJK/run.json`,
browser `/tmp/pi-web-test-browser.t8xSA8/run.json`; source SHA-256
`4ed2141feb4f5244122345024a2d291b7f4e124fea41ca2c607b18ec38174423`.
Four/four was deliberately selected instead of twelve/four because concurrent
CPU-heavy processes exceeded 100% each and host load was 18.79; available RAM was
47,650 MiB. Core stopped at 275 passed / 1 failed / 246 not started of 522 files.
The Git-plugin installed bridge independently failed at the same missing line 2500;
Markdown was interrupted, not passed. Other partial passes are not full acceptance.

Independent diagnosis reproduced the exact unchanged mounted failure once with one
worker (`/tmp/guided-review-plugin-card-focused.5WA4TE.log`) and compared actual main.
The added optional selection callback required the retained model as a memo dependency,
but replacing its `context`/`full` dependencies with only model identity hid in-place
presentation mutations from Pierre's options. Restoring the current field dependencies
fixed the original regression without assertion, fixture or deadline changes.
Four focused files / **27 tests passed**, command wall **112s**:
`/tmp/guided-workflow-context-fix.SUvMqy.log`, `/tmp/pi-web-test-core.d7tVAK/run.json`,
source SHA-256 `d90970e65866d80a1565f45efaf8f077c1f05adfdd3fb9313b5b638f288a5079`.
The fields are subsequently bound as explicit render-time snapshots so the linter
recognizes both values alongside the retained model (no suppression). The final
composed suite must verify that exact follow-up. Source writing is stopped for export.

The active plan owns current acceptance/integration status. No host service,
publication, unrelated guidance worktree or user-runtime-validation claim is involved.
