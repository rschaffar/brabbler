# Chat pane controls and file reveal

## Goal

Allow shrinking chat from its right-hand divider and hiding/restoring it without losing session state; locate an open file in the sidebar Explorer with one action.

## Plan Relationship

The existing Git Explorer fullscreen plan owns whole-Explorer expansion. ADR 0027 owns stable file-view hosts and captured resource context. This change preserves those lifetimes and all file authorization boundaries.

## Plan

- [x] Remove the arbitrary wide-screen Files width cap, retain a 320px chat minimum, and add desktop chat hide/restore controls without unmounting chat or file views; focused layout core and file-edit browser checks pass (evidence below).
- [ ] Add a file-pane Reveal in explorer action, carrying captured file context to an expanded, highlighted sidebar tree; verify nested paths, filtered/Changes views, repeated reveals and context boundaries.
- [ ] Update feature documentation and add regression coverage; obtain independent read-only review.
- [ ] Run complete Nix acceptance with admitted explicit four/four widths after source settles; record candidate/input identities, timings and artifacts.

## Iteration evidence

Isolation: `feat/chat-pane-file-reveal` in `/home/robert/projects/3rdparty/pi-web-worktrees/chat-pane-file-reveal`, starting at `b6c165ebf39e911bc38015d9023643047a042e74`.

- Focused `nix run .#test -- core --jobs 4` selecting `lib/panel-layout.test.mjs`, `lib/explorer-reveal.test.mjs`, `components/FileExplorer.reveal.test.mjs`, `components/FileExplorer.uploads.test.mjs`, `components/AppShell.mobile-toolbar.test.mjs`, `components/AppShell.file-viewer-state.test.mjs`, and `components/AppShell.terminal.test.mjs`: static checks and 39/39 tests across seven files passed. End-to-end 48.939s; evidence `/tmp/pi-web-test-core.xnCfgf/run.json`. Snapshot digest `46d8903f9b88b1c2eafda41fa0ea0d285ed111e9de41b44f5cafd18c31249239`. Later focus-once and sidebar-command regressions are not part of this earlier run.
- `nix run .#test -- e2e --group markdown`: passed desktop/mobile chains, including nested/repeated/search/external-root reveals, retained reader identity and unchanged selected chat. End-to-end 127.249s; sandbox execution 115.426s; evidence `/tmp/pi-web-test-browser.nM8Mtn/run.json`. Application inputs unchanged from the earlier focused checks; the test-selector fixes and additional core tests are new inputs.
- `nix run .#test -- e2e --group file-edit`: passed both viewport chains, including new chat controls and retained HTML/composer identity. End-to-end 77.961s; sandbox execution 43.597s, pre-sandbox interval 30.556s (prerequisite realization overlapped the Markdown invocation). Same snapshot digest; evidence `/tmp/pi-web-test-browser.hIOSEw/run.json`.
- Initial focused core failed an old source-regex assertion at `/tmp/pi-web-test-core.PUWWb7/run.json` (42.577s). The assertion now checks the new conditional rail geometry and covered-chat state without weakening Explorer's inert-ancestor requirement.
- Markdown iteration failures remain retained: `/tmp/pi-web-test-browser.Ac81Eb/run.json` (162.830s end-to-end, 71.878s sandbox) used a folder-button label without its actual parentheses; screenshot confirmed correct revelation. `/tmp/pi-web-test-browser.UK6Nd0/run.json` (58.998s end-to-end, 47.422s sandbox) found both chat and preview links during panel-close animation; chat-link actions are now scoped to `#chat-content`. No deadline changes, forced clicks or unchanged retries.
- Independent read-only review identified stale command replay/focus, pending Return cancellation and alternate-root upload destinations. The fixes consume commands independently of highlighting/focus, synchronously invalidate Return generations, and use the explicit browsing root for toolbar/background uploads. The reviewer rechecked all three and found no remaining concrete issue. No access grants or selected-checkout changes were added.

## Non-Goals

No file-access grants, automatic project/session switching, persisted file layouts or chat visibility preference, docking framework, installed-service activation or remote publication.

## Completion Checklist

- [x] Chat resizes, hides and restores with draft and mounted viewer identity intact; file-edit browser coverage passes at 1280/390px, including 3440px resizing and a 900px transition.
- [ ] Reveal opens the correct Explorer location without changing the selected chat or weakening path security.
- [ ] Required acceptance and review have recorded outcomes; failures remain visible.
- [ ] Local integration intent is resolved through current Git policy and exact-state approval; cleanup remains separate.
