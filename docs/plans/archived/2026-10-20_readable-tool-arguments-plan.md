# Readable tool arguments

## Goal

Port upstream's flat argument rows, preserving complete argument access and this fork's immutable history, streaming, special renderers, receipts and security boundaries.

## Context

User explicitly approved implementation after the chat-only assessment. Base `rst-main`: `1fe0a04c2d6d11e0c301457e379289d3a61f1508`; isolated branch `feat/readable-tool-arguments`, worktree `../pi-web-worktrees/readable-tool-arguments`. Cached upstream `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`, lead `083fd11ba54674d0939e809e567d90ad78abacab`, write-view prerequisite `038057f4797568394fd2a8f4a800e2e5d1bef071`. No remote, live provider, credential/session-data access or installed-host deployment is authorized.

## Plan Relationship

Earlier easy-wins/security/followup ports are complete and archived. This plan owns only argument presentation and its acceptance, not streaming architecture, message identity, file authority, SDK/codemode/MCP redesign or dependency changes. Maintained feature/session guides own the resulting contract. The global Git lifecycle owns later completion intent, exact-state integration approval and separately approved cleanup.

## Plan

- [x] Add pure flat-field/write-view selection with complete fallback; verify scalar/nested/empty/unsupported inputs and conservative write eligibility in focused core tests.
- [x] Add escaped, accessible argument rows, raw disclosure and canonical full copying; preserve rich views and show edit input without a usable diff. Verify MessageView rendering and desktop/mobile browser interactions.
- [x] Mirror bounded presentation changes in demo without replacing its renderer; inspect exact helper/component/clipboard parity and update maintained owning guides.
- [x] Obtain independent read-only safety review and resolve concrete findings before final acceptance. Final bounded follow-up found no remaining blockers; no reviewer ran tests or wrote source.
- [x] Run focused Nix core/history checks, then fresh full `nix run .#test -- all --workers 4 --jobs 4` after admission; record exact identities, commands, results, timings and artifacts, retaining failures.
- [x] Commit coherent reviewed changes; resolve completion intent and hand the verified clean candidate to the mandatory local `rst-main` non-FF integration lifecycle. User selected local integration through `ask_user`; the exact-state merge card and durable Git receipt own approval/execution, not this archive.

## Risks

Long labels must not clip on phones; multiline scroll regions need keyboard access. Display strings never become Markdown, links or file authority. Rows and write text are not canonical JSON: copying always uses original complete input or exact partial raw input. Result errors/unknown tools and complete nested edits retain readable fallbacks. No persisted-data migration, dependency/pin change or deployment is included. The main agent is sole writer/test coordinator; researchers/reviewers are read-only.

## Focused evidence and corrections

- First focused core failed after 126s command wall time: `/tmp/pi-web-tool-arguments-core.mXNfEL.log`, `/tmp/pi-web-test-core.UoWmxC/run.json`. New SSR assertion incorrectly expected React's `tabIndex` spelling in emitted HTML; corrected to native lowercase `tabindex` without changing the application.
- Next focused core failed after 53s: `/tmp/pi-web-tool-arguments-core.Jozev4.log`, `/tmp/pi-web-test-core.6wCxNk/run.json`. New cross-demo parity assertion could not read `demo/`, intentionally absent from root's Nix source export. Removed that invalid cross-fileset assertion rather than expanding the export or skipping a test; direct source inspection (`cmp`) confirms helper/component/clipboard identity. Demo remains independently compiled, not claimed browser-tested by root acceptance.
- First history run failed after 153s including package realization: `/tmp/pi-web-tool-arguments-history.5KorXf.log`, `/tmp/pi-web-test-browser.9D9sgt/run.json`. Font fixture changed a document variable shadowed by chat's local variable; scope the test override to the argument body. No application/style change, deadline increase or suppressed error.
- Focused core passed 9 files / 80 tests with four workers, 75s command wall time: `/tmp/pi-web-tool-arguments-core.Yg4B3G.log`, `/tmp/pi-web-test-core.OEVrFb/run.json`. Includes static preparation and the original MessageView/clipboard/streaming/source-authority regressions.
- Desktop 1280px and touch-mobile 390px history passed, 57s command wall time / 41.780s inner execution: `/tmp/pi-web-tool-arguments-history.JQd2L3.log`, `/tmp/pi-web-test-browser.7Uybtk/run.json`. Both focused runs exported digest `ff30377dac7e0d88c7bf7a79b02234c7c6435f23b880d92cc49965e91831a504`; commands include preparation/realization and are not benchmarks.
- Independent review fixed the demo clipboard fallback's pre-existing false-success behavior and conditional raw-disclosure ARIA target. Subsequent fixture review identified a possible initial-state race; now await the idle mount response before synthetic streaming, and abort failed intercepted reads before reporting them. This post-pass fixture refinement still requires subsequent browser/full acceptance.

## Rebase and prior full-run failure

- Original candidate `44d436dcda28218ac0242b48c2bab385ed236929` full four/four acceptance stopped after **271s command wall time**: `/tmp/pi-web-tool-arguments-all.xcaXaH.log`, `/tmp/pi-web-test-core.Gq80n9/run.json`, `/tmp/pi-web-test-browser.up3XdS/run.json`. Unchanged Git-plugin server case 32 missed its ten-second commit-start marker. Remaining coverage stopped/drained; this was not complete acceptance. Retained source `/tmp/pi-web-test-source-FMcCaY`, digest `b441ce43a806377124c82cdc8a874c845e4da9305456742a5073cb69fe94f6bd`.
- Same unchanged Git file then passed all 40 cases in a diagnostic, **180s command wall time**: `/tmp/pi-web-tool-arguments-git-diagnostic.Cg4QdR.log`, `/tmp/pi-web-test-core.AY3nXn/run.json`. That passing diagnostic is not a fix or proof of the original cause. Independent review found all preflight Git calls incurred Node startup and a timeout could leave the pending operation undrained. No continuous external-workload trace proves whether another session overlapped the failure.
- User explicitly requested rebase and continuation. Local `rst-main` advanced to `2cdddaba1fcc70f9a7ed57fc88ef28155f9035cf`, including existing fixture repair `839d642` (shell forwarding of preflight Git, original commit delay/deadline, pending-operation drain, dedicated gate regressions). No additional Git/plugin repair was made by this feature.
- First integrated rebase conflicted only in browser imports and the history coverage row. Aborted, verified clean original tip, retained `backup/readable-tool-arguments-before-rebase-20261021-081736`, then mechanically replayed preserving both changes. Rebased port `1fc70756d4a269e4bd51600dc97b132b4a1ff976`; range-diff shows only those contextual adaptations. All target changes remain intact.
- New target font preferences require monospace row values to follow the shared base weight as well as family/size. Added that narrow root/demo style binding with SSR and desktop/mobile browser assertions; no font/dependency download or preference persistence changes.

## Rebased focused verification

- Rebased source plus the reviewed mono-weight binding passed focused core **11 files / 123 tests**, **83s command wall time**: `/tmp/pi-web-tool-arguments-rebased-core.C3azXF.log`, `/tmp/pi-web-test-core.q4EDZZ/run.json`. Includes existing Git server and new commit-gate regressions, with original deadlines intact.
- Same source passed desktop 1280px/touch-mobile 390px history, **118s command wall time** including isolated package realization, **31.137s browser execution**: `/tmp/pi-web-tool-arguments-rebased-history.s3C5GX.log`, `/tmp/pi-web-test-browser.u5m7iW/run.json`. The expanded keyboard/IME/reading-position chain remains intact alongside argument-copy/streaming proofs. These are focused passes, not complete acceptance or a cold/warm benchmark.
- Independent rebase review found no separate blockers; font-weight correction addresses table cells not covered by the target's global `pre, code` rule. App/demo helpers, argument component and clipboard source remain identical; dependency/Nix inputs are unchanged relative to the selected target.

## Complete acceptance and handoff

- Accepted application/test candidate: **`02ccf2a5f93a43bf5a71b7e3d8db3dfb04f0efc8`**, based on local **`2cdddaba1fcc70f9a7ed57fc88ef28155f9035cf`**. Subsequent evidence/status archival changes only this document; earlier runs are not relabeled as new-tip execution.
- Fresh **`nix run .#test -- all --workers 4 --jobs 4` passed**, **408s command wall time**, including in-command realization. Native x86_64 Linux, 32 logical CPUs, about 36 GiB available at admission; no other matching acceptance process was observed immediately before launch, not a continuous exclusivity claim. Requested/effective widths: four browser sandboxes and four core workers; conservative combined estimate 16 CPUs / 27 GiB, not a reservation. Prerequisites were warm from the recorded focused runs; no extra prewarming was performed. These are not cold-cache or performance-comparison results.
- Log `/tmp/pi-web-tool-arguments-rebased-all.rVO4wx.log`; verified snapshot `/tmp/pi-web-test-source-gbjaCR`; outer content/mode digest **`d34c403f38cfd5604e7e9946933f876730a0cd8265d7c85a7793bc47bb504dc2`**, selection `/tmp/pi-web-test-source-gbjaCR/selection.json`. Core filtered digest `4d3f25770dcb138c3afe8b55f3d03b0828fcc96eda1a90f9080deaa545dbe2df`.
- Core/static/plugin: **388 files / 2,918 tests / 12 suites**, all passed, none failed/skipped/cancelled/not-started; `/tmp/pi-web-test-core.8ATsFq/run.json`, `/nix/store/0pspymcv0vvibqk6fciawmsmzgvxql8s-pi-web-core-checks`. Inclusive core interval **347.789s**, including realization/static preparation; no separate core-preparation measurement is claimed. Bounded process observations and runner settlement passed.
- Browser/terminal: **24 groups / 53 exact scenario receipts**, every group passed with matching inventory, collected artifacts, settled execution and closed ports; `/tmp/pi-web-test-browser.oFBTp8/run.json`. Browser-driver interval **332.960s**, initial preparation/first-capsule interval **7.154s**, inner-capsule span **325.688s**. Existing source links, receipts, keyboard/IME, split workspaces and full browser inventory remain included.
- Genuine Home Manager VM passed activation/default-target startup, private environment/permissions, durable write/restart, real HTTP PTY, collection and settlement; `/tmp/pwv-CmnOmg/run.json`. Service inactive/dead, MainPID zero, authenticated cgroup absent, port refused. Inclusive service interval **67.591s**, guest evidence interval **19.185s**. Browser and VM use the same production package `/nix/store/z0jcq1rd9svf7yp960z5b7ilm9yh8vgf-pi-web-0.9.3`. Overlapping level intervals must not be summed into command runtime.
- Maintained behavior is owned by `docs/feature-internals.md`, `docs/session-internals.md` and `e2e/README.md`. Independent reviews are resolved. Demo parity is source-reviewed, not separately browser-tested or deployed. SDK/Node/Next/Nix pins are unchanged relative to target; no remote/provider/live-secret or installed-host operation was performed.
- User chose **integrate into local `rst-main`** after acceptance. This completed plan is archived at the verified handoff. Exact-state approval, unsigned non-FF execution and separate cleanup remain with the Git lifecycle and its receipts. The backup branch and retained failures are outside ordinary feature cleanup; no archive entry claims an unexecuted merge, publication or host deployment.

## Completion Checklist

- [x] Rows/write/raw/copy/fallback behavior is covered without changing historical entry IDs, source links, receipts or process grouping.
- [x] Independent review resolved and full core/static/plugin, browser/terminal and genuine deployment-VM acceptance passed for the recorded candidate.
- [x] Maintained guides updated; exact feature/integration handoff status and demo evidence limit reported without claiming deployment or publication.
