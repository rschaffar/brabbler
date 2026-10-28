# Git Workflow override matrix — verified implementation

## Goal

Apply the user-approved sparse **All repositories → named repository → This session** matrix to the actual Git Workflow settings panel. Show saved values, inheritance and the winning source together on desktop/mobile, without a fourth editable/result scope. The user's “apply” request authorized implementation; dedicated-worktree creation and later investigation/remediation of the move/SSE acceptance blocker were explicitly approved.

## Maintained owners and preserved boundaries

- [Git plugin guide](../../git-workflow-plugin.md): cell-bound destinations, explicit Follow/custom modes, false/null/empty text/empty checks versus absence, parent-equal pins, previews, global-only enablement, browser-only restrictions, defaults and workflow-only presets. No policy/schema migration or automatic settings deletion occurs.
- [Test-writing recipes](../../test-writing.md): actual mounted settings composition and promise/DOM/native proof boundaries. Non-opted-in plugins retain their legacy UI, including Session Launch immediate-save behavior.
- [Session contracts](../../session-internals.md): the user-authorized persisted-startup/relocation repair. Root admission precedes discovery; the validated family/linked write footprint fences later startup; prior constructors and all original move guards remain checked. Current header identity/cwd/account bindings remain authoritative. Bounded path/ID hints never grant authority or cache a working context.
- [Review notebooks](../../review-notebooks.md): the strict test-observer correction distinguishes exact existing-session catalogue/lease maintenance from agent execution. Neither preparation nor adding a draft submits a model turn; Send remains a separate explicit action.
- Existing [session-policy ADR](../../adr/0016-session-git-policy.md) and [browser-discard ADR](../../adr/0022-browser-resource-discard.md) still govern execution. Git semantics remain plugin-owned, repository identity is canonical, session bindings stay own-repository only, and schema version remains 1. Legacy unsupported session discard remains readable/clearable but is ignored for effective value and source; new session sets are rejected.
- Independently approved HTML-preview guidance and robot branding arrived through local-main rebases, not this feature. The separate Firefox crash investigation is not completed here. No running service, live settings, browser profile, remote Git resource or publication was changed by this task.

## Plan

- [x] Implement shared presence-based scope/value projection and opt-in presentation metadata; verify inheritance, pins, explicit values, applicability and immutable previews with production-owner tests.
- [x] Implement responsive three-scope matrix and native scope-bound field/preset editors, failure drafts, current-context fencing, focus recovery, filters and centralized English copy; retain other bundled-plugin behavior.
- [x] Preserve the original mounted and installed obligations, exact writes and following Git chain; add representative native geometry, modality, focus, provenance and durable save/reset/readback.
- [x] Resolve the explicitly user-authorized move/SSE blocker with early/progressive startup fencing and canonical re-resolution, deterministic production-owner cases, unchanged native journey and independent safety review.
- [x] Correct only the guided-review observer's exact maintenance classification, preserving execution refusals, observation history, complete native inputs and truthful receipt versioning; verify counterexample/green and independent review.
- [x] Update maintained owners and pass complete required Nix acceptance with exact inputs, widths, results, artifacts and timing.
- [x] Hand off the verified candidate to this session's global `git-worktrees` lifecycle for exact-state local non-FF integration approval/execution and separate cleanup. Archival is not their receipt or authority.

## Completion Checklist

- [x] Matrix implementation preserves policy/storage/security boundaries and explicit-versus-inherited intent.
- [x] Original assertions/inputs are accounted for; focused checks and meaningful counterexamples distinguish production defects from fixture assumptions.
- [x] Core/static/bundled-plugin, whole installed browser/terminal inventory and genuine Home Manager deployment acceptance all passed.
- [x] Current mechanisms/proof limits have maintained owners; remaining Git gates have one explicit receiving owner. Feature resources and backup remain until separately authorized cleanup.

## Exact complete acceptance

Feature worktree: `/home/robert/projects/3rdparty/brabbler-worktrees/git-settings-override-matrix`; branch: `feat/git-settings-override-matrix`. Starting local main: `7aeb430f803556125abc24213ecd46f87c262efb`. Tested candidate: **`738d5dec466906271b70b84d08ed539bd5625552`**, based on local main **`0c239e29d96753e81a82ba9ad0f87ea8fa14a042`**.

Command: **`nix run .#test -- all --workers 4 --jobs 4`**. End-to-end: **498.632 seconds**, including in-run realization. Source content/mode SHA-256: **`1bab3c789b78f13fc3686523912e436de3ad36c0cf130f833302ccf126c7c079`**. Retained source/selection: `/tmp/brabbler-test-source-d83rJE/{source.json,selection.json}`. Whole log: `/tmp/brabbler-matrix-checks.1zqn1r/full-acceptance-7.log`.

| Level | Complete result | Report |
| --- | --- | --- |
| Core/static/bundled plugins | **527/527 files, 4,361/4,361 tests, 14 suites**, zero skipped/cancelled/todo cases | `/tmp/brabbler-test-core.lebN2f/run.json`; `artifacts/run-ho5h53/summary.json` |
| Installed browser/terminal | **26/26 groups, 60/60 exact scenario/input receipts** | `/tmp/brabbler-test-browser.7FyC3V/run.json` |
| Genuine Home Manager VM | Activation, environment/permissions, durable HTTP write, restart persistence and production PTY passed | `/tmp/pwv-3CmVPH/run.json` |

Requested/effective widths: **4/4 core workers, 4 browser sandboxes**. Selection admitted overlapping levels at 32 CPUs / 32,255,619,072 bytes available (about 30.04 GiB), above the estimated 16-CPU/27-GiB four/four requirement but below 32-CPU/43-GiB twelve/four. Original competing NixOS build had settled, but further NixOS builds were observed during this run; this is not machine-exclusive or benchmark evidence. The explicit two-browser earlier attempt was based on actual admission refusal and fluctuating shared memory, not a focused-run budget carried forward by habit. No deadline, sandbox, error filter or admission rule was weakened.

| Timing boundary | Seconds |
| --- | ---: |
| Core wrapper, including in-run realization | 492.544 |
| Core before first file / first-file-to-last-settlement span | 3.102 / 489.011 |
| Browser wrapper | 376.594 |
| Browser support realization / definition preparation | 4.906 / 6.751 |
| Browser group-client execution span | 364.930 |
| VM wrapper, including realization / guest evidence interval | 91.310 / 23.163 |

Levels overlap; intervals are not additive. Prerequisites were warmed separately by the final-source mobile run (168.572s including realization) and corrected whole Markdown group (221.024s). Do not compare this run with cold/preparing or differently sized/concurrent attempts as a performance result. Owned observations/VM bulk cleanup passed; bounded settlement is not universal escaped-descendant or idle certification.

Final desktop/mobile matrix images were visually inspected: `/nix/store/crk4nx61c2q7qc60chmabwn7nij4gbkx-brabbler-browser-git-plugin-diagnostics/artifacts/git-settings-matrix-1280.png` and `git-settings-matrix-390.png`.

## Assertion dispositions, focused proof and review

- Original `components/SettingsUi.test.mjs:571–709` at starting main retains all seven exact writes, both presets, masking distinctions, unchanged permissions/targets/checks, original parent/Settings save-promise identity and held reset/unmount/readback. Only obsolete selectors/presentation expectations changed. Current mounted owner has **34 passing cases**, including eight session/cwd load/save A–B–A schedules and actual SettingsPanel/PluginsConfig/Session Launch composition.
- Existing Git bridge retains its exact four-write prefix and complete following native Git approval/reader/receipt/Stop chain. Both original en-desktop/en-mobile-tall inputs dispatch **`git-plugin/matrix-settings-v10`** with independent expectations and v8/v9 retirement negatives. Winning inherited cells stay dashed; explicit saved cells stay solid, including reset transitions.
- Both original Markdown chains remain intact and dispatch **`render-files-native-v4@legacy-desktop` / `render-touch-wiring-v3@legacy-mobile`**. Earlier IDs fail before callbacks. Incoming file-edit preview v5 remains unchanged. No fixture action/authority assertion was dropped to manufacture acceptance.
- Focused projection 6, native settings 7, native session settings 5, receipt owner 27, manager-route 4 and mounted settings 34 cases passed during development. Final relocation owners passed **87 RPC**, **1 actual mover with original and added assertions**, and **11 directory-admission** cases at source `467f311c8d1d0665d9c4e2db16ad739996cec4afdc9b0c04f84816f2a5f363bf` (`/tmp/brabbler-test-core.gczTkS`, `.pWzbsH`, `.rCDTCP`; 24.178s / 8.364s / 7.277s). Complete acceptance supersedes neither their identities nor their proof limits.
- Independent `openai-codex/gpt-6-astra` and `openai-codex/gpt-6.1-sol` reviews used max thinking. Matrix findings were addressed. Later scoped Astra review found no concrete relocation/startup blockers after the stale-path follow-up; scoped Sol review found no weakening in the exact maintenance-tuple correction. Those are source/log reviews, not substitute test execution.

## Retained counterexamples, retractions and failed attempts

All raw logs, fault copies, prior plan drafts and status files remain under `/tmp/brabbler-matrix-checks.1zqn1r/`; run roots below remain separate evidence, never relabeled as final acceptance.

- Removing production cancel isolation failed the enclosing-manager assertion (**32/33**); identical restoration returned **33/33** (`/tmp/brabbler-test-core.9la41y`, `.cW3imn`). Hard-coding preset previews to session scope failed the new non-session destination assertion (**33/34**); restoring component SHA `dc6ce038f7c388ec4fc29cbcf1b6a724dd28a0592abed6c6e8cdb956650c0c98` returned **34/34** (`.wYMEPU`, `.5o3tbL`). Selector/whitespace-only setup mistakes are not production counterexamples.
- **Retracted native assumption:** Chromium Tab can traverse browser chrome with an unfocused document/BODY while the dialog remains modal. Retained `.bFsgeP`/`.7tbw1S` browser traces establish that state, not an application focus-trap defect. The corrected strict test rejects background-content focus, clipping and non-modal state; explicit native background-focus refusal remains checked. It then exposed a genuine outer Settings Escape close (`.VzU6Wm`), fixed by capture isolation without cancelling idle native close-watcher/select-popup behavior.
- The first full attempt on `5c432f93d39388005018c949061490a1fec90123` failed obsolete manager-route setup after **186.968s**: 28 core files passed, one failed, 498 were unstarted, browser interrupted. New session discard sets are deliberately invalid. The original legacy stored Deny contrast and global/project assertions were preserved using private fixture storage and real canonical identity, with new-write refusal added. All four route cases passed before the later complete run. No policy was relaxed.
- The earlier candidate `7f8db1240863f1c27e6a595e500354c6617abeef` fully passed **527 files / 4,343 tests / 26 groups / VM in 527.311s**, source `03b88bbd3d6be3379045cfac66ff34cdbd4bcb4417beb640159a985bdf74419c` (`.Yyem8O`, browser `.Ify7VH`, VM `/tmp/pwv-NC5qWW`). This predates the provenance-border and relocation follow-ups. A new computed-style assertion caught its solid inherited winner (`/tmp/brabbler-test-browser.LKoI5y`, **21.652s**, `solid !== dashed`); the CSS fix preserves border style while highlighting by color/width/background.
- Full attempt on `41cc6edfcbd6f390a518641335beff3b1db36c86` stopped after **447.648s** at existing mobile Move: 20 browser groups passed, one failed, five unstarted; core was interrupted. Both matrix-v10 inputs passed. Trace `/nix/store/680zqcnr23wbfkn5qb7pwx0427jyjl0y-brabbler-browser-mobile-sidebar-diagnostics/artifacts/context-1.zip` records one 247ms Move POST returning 409 (“A session reopened…”), with a new EventSource request about 31ms into Move. The old stream ended about 982ms before Move; timing is consistent with a pending reconnect, not proof that move-time eviction caused it. Teardown's incomplete SSE response followed the primary refusal. The explicitly approved repair coordinates ordinary persisted startup with relocation, not retries or weaker move guards.
- Preparation attempts 4/5 on unchanged `1b86279d` ran no tests: **7.822s** source-identity pre-read refusal, then **2.125s** worker-admission refusal. `source-refusal-observation.md` records matching checkout/snapshot/store bytes and shared read-only store hardlink metadata; the first-pass identity was not published, so the precise metadata writer/field is not proven. Guards were preserved. Final-source unchanged mobile then passed (`/tmp/brabbler-test-browser.GjIS1f`, source `64f160fff9685b6199f1584af9d9824d7e90885693d8998f7e3cf818161519a2`).
- Full attempt 6 at two-browser/four-core overlap stopped after **260.760s**: two groups passed, Markdown failed and 23 were unstarted; core was interrupted. Its literal null-body same-session lease POST is non-executing maintenance, independently confirmed against the route. The old observer failed the same literal positive (**1/2**, `.DZYIto`, **116.918s**); the corrected exact observer plus inventory passed **29/29** (`.7tLZba`, **75.417s**) and both whole Markdown inputs passed (`/tmp/brabbler-test-browser.msacKx`, source `6c1b381ac3a777ec988c9735685edb974e5a1096e33393667133e26c09a6c21f`). Observations and all old execution negatives remain, with new foreign/query/payload/method negatives. No application behavior or general console/5xx handling changed.

## Proof limits, recovery and Git handoff

Mounted observers own complete inner `Settings.load/save` I/O promises, not void editor wrapper tails or universal idle. DOM/act and installed dialog-hidden assertions cover visible settlement separately. A–B–A schedules protect the receiving instance's settled error/draft/result, not an independently held current in-flight busy state. Jsdom shims do not prove layout/modality; installed native checks use pinned Chromium, not Firefox certification.

No settings migration is required to revert the matrix. Cleared overrides are intentional edits: restore only a user-selected value, never overwrite later changes from a stale snapshot. An unconfirmed save can have committed server-side; reopen/read before deciding to retry. Verification writes only disposable fixtures. Relocation hints are bounded, in-memory identity aids; eviction and unproven disappeared-path aliases refuse rather than invent a binding.

The initial local-main rebase conflict was aborted, the original clean tip retained at `backup/git-settings-matrix-pre-rebase-20261028-131150`, and a deliberate mechanical retry preserved both Git matrix-v9 and incoming file-edit-v5 rows. The later branding rebase preserved both commits by range-diff. The backup is not implicitly disposable.

Remaining owner: this receiving session under the global **`git-worktrees` skill**. Obtain exact-state approval through the Git tool and perform an ordinary unsigned non-fast-forward merge into current local `main`, then verify parents/tree/signature absence. The final archive/index follow-up is documentation-only: verify its delta and unchanged application/test inputs proportionally; do not relabel the 738d5dec run as a new-tip run. Publication, installed-service activation and feature-resource/backup cleanup remain separate. Archival grants none of them.
