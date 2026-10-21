# Chat pane controls and file reveal

## Goal

Allow shrinking chat from its right-hand divider and hiding/restoring it without losing session state; locate an open file in the sidebar Explorer with one action.

## Plan Relationship

The existing Git Explorer fullscreen plan owns whole-Explorer expansion. ADR 0027 owns stable file-view hosts and captured resource context. This change preserves those lifetimes and all file authorization boundaries.

## Plan

- [x] Remove the arbitrary wide-screen Files width cap, retain a 320px chat minimum, and add desktop chat hide/restore controls without unmounting chat or file views; focused layout core and file-edit browser checks pass (evidence below).
- [x] Add a file-pane Reveal in explorer action, carrying captured file context to an expanded, highlighted sidebar tree; nested/repeated/search/external-root browser proofs and executable sidebar Changes/search command tests pass.
- [x] Update `docs/feature-internals.md` and add regression coverage; independent read-only review and re-review completed.
- [x] Run complete Nix acceptance with admitted explicit four/four widths after source settles; candidate/input identities, timings and artifacts recorded below.

## Iteration evidence

Isolation: `feat/chat-pane-file-reveal` in `/home/robert/projects/3rdparty/pi-web-worktrees/chat-pane-file-reveal`, starting at `b6c165ebf39e911bc38015d9023643047a042e74`.

- Focused `nix run .#test -- core --jobs 4` selecting `lib/panel-layout.test.mjs`, `lib/explorer-reveal.test.mjs`, `components/FileExplorer.reveal.test.mjs`, `components/FileExplorer.uploads.test.mjs`, `components/AppShell.mobile-toolbar.test.mjs`, `components/AppShell.file-viewer-state.test.mjs`, and `components/AppShell.terminal.test.mjs`: static checks and 39/39 tests across seven files passed. End-to-end 48.939s; evidence `/tmp/pi-web-test-core.xnCfgf/run.json`. Snapshot digest `46d8903f9b88b1c2eafda41fa0ea0d285ed111e9de41b44f5cafd18c31249239`. Later focus-once and sidebar-command regressions are not part of this earlier run.
- `nix run .#test -- e2e --group markdown`: passed desktop/mobile chains, including nested/repeated/search/external-root reveals, retained reader identity and unchanged selected chat. End-to-end 127.249s; sandbox execution 115.426s; evidence `/tmp/pi-web-test-browser.nM8Mtn/run.json`. Application inputs unchanged from the earlier focused checks; the test-selector fixes and additional core tests are new inputs.
- `nix run .#test -- e2e --group file-edit`: passed both viewport chains, including new chat controls and retained HTML/composer identity. End-to-end 77.961s; sandbox execution 43.597s, pre-sandbox interval 30.556s (prerequisite realization overlapped the Markdown invocation). Same snapshot digest; evidence `/tmp/pi-web-test-browser.hIOSEw/run.json`.
- Initial focused core failed an old source-regex assertion at `/tmp/pi-web-test-core.PUWWb7/run.json` (42.577s). The assertion now checks the new conditional rail geometry and covered-chat state without weakening Explorer's inert-ancestor requirement.
- Markdown iteration failures remain retained: `/tmp/pi-web-test-browser.Ac81Eb/run.json` (162.830s end-to-end, 71.878s sandbox) used a folder-button label without its actual parentheses; screenshot confirmed correct revelation. `/tmp/pi-web-test-browser.UK6Nd0/run.json` (58.998s end-to-end, 47.422s sandbox) found both chat and preview links during panel-close animation; chat-link actions are now scoped to `#chat-content`. No deadline changes, forced clicks or unchanged retries.
- Independent read-only review identified stale command replay/focus, pending Return cancellation and alternate-root upload destinations. The fixes consume commands independently of highlighting/focus, synchronously invalidate Return generations, and use the explicit browsing root for toolbar/background uploads. The reviewer rechecked all three and found no remaining concrete issue. No access grants or selected-checkout changes were added.

## Complete acceptance and handoff

`nix run .#test -- all --workers 4 --jobs 4` passed on implementation commit `f4d274d760e92bb727658981c400a1e4311ea183`. Export digest `932306b6f3c564d93524251a7d5d7a2728a3b7e9831535dadb65ab805bb5c34c`; retained export/selection `/tmp/pi-web-test-source-WayDJH/`. Requested/effective browser and core widths both four; admitted on 32 CPUs/about 42.8 GiB available memory, with aggregate 16-CPU/27-GiB estimates and core/browser overlap. Earlier focused runs warmed application/prerequisite outputs; this is fresh execution, not a cold-cache benchmark.

- End-to-end command: **402.352s** including in-run realization.
- Core: **384/384 files, 2,892/2,892 tests, 12 suites**, complete static/plugin checks. Level interval 350.976s; preparation to first test 52.800s; test-execution window 297.849s. `/tmp/pi-web-test-core.l4Wv0x/run.json`; immutable artifacts `/nix/store/ssappb1vy5rfxmkxv4h2ncn6g26ll1q5-pi-web-core-checks/artifacts/run-TbbSuw/`.
- Browser/terminal: **24/24 groups** passed. Level interval 327.502s; pre-first-sandbox interval 7.225s; sandbox execution window 320.152s. `/tmp/pi-web-test-browser.PM7lpf/run.json` includes every capsule, trace and success-only coverage inventory.
- Genuine Home Manager deployment VM: passed. Level interval 68.223s, VM test script 19.590s; remaining interval includes realization/boot/collection. `/tmp/pwv-NpHl5n/run.json`. It overlaps the end of core; intervals must not be added as serial time.

`git_rebase` confirmed the feature already based on unchanged local `rst-main` at `b6c165ebf39e911bc38015d9023643047a042e74`, preserving implementation ID and tested inputs. The following archive/evidence-only commit does not change application or test inputs; its proportional checks are document/link review and `git diff --check`, not a relabelled full-suite run.

The implementation plan is retired. The current session's Git workflow owns the remaining exact-state non-fast-forward merge approval into the primary checkout `/home/robert/projects/3rdparty/pi-web` and the separately gated cleanup of `feat/chat-pane-file-reveal` and its linked worktree. No installed-service activation, remote publication or cleanup is authorized by this document.

## Non-Goals

No file-access grants, automatic project/session switching, persisted file layouts or chat visibility preference, docking framework, installed-service activation or remote publication.

## Completion Checklist

- [x] Chat resizes, hides and restores with draft and mounted viewer identity intact; file-edit browser coverage passes at 1280/390px, including 3440px resizing and a 900px transition.
- [x] Reveal opens the correct Explorer location without changing the selected chat or weakening path security.
- [x] Required acceptance and review have recorded outcomes; iteration failures remain retained above.
- [x] Local integration intent is resolved: the user selected preparing integration into local `rst-main`. Exact-state approval/execution and separate cleanup are explicitly handed off to this conversation's bounded Git workflow, not claimed as performed by this archived implementation plan.
