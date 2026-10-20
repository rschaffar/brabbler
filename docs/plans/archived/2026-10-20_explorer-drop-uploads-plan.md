# Explorer uploads with precise directory targets

## Goal

Add Explorer drag-and-drop and accessible folder-specific uploads without expanding file authority, with safer existing-file replacement and full Nix acceptance.

## Context and Plan Relationship

User explicitly authorized implementation after a read-only assessment, then chose file-row drops into the containing folder, folder-specific picker actions, and safer overwrite handling. Dedicated branch `feat/explorer-drop-uploads`, worktree `/home/robert/projects/3rdparty/pi-web-worktrees/explorer-drop-uploads`, base local `rst-main` `1fe0a04c2d6d11e0c301457e379289d3a61f1508`. CodeGraph initialized successfully. Parent is sole repository writer and acceptance coordinator; delegated research/review is read-only.

Cached upstream `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`, lead `5ec5a745` (#1192), depends on the drop parser/client extraction from `c3c5c6fb` (#1094). Port behavior selectively, not upstream composer uploads or sidebar lifecycle changes. Completed batches `6bc2c3f`, `8e6735a`, `1fe0a04` remain authoritative; their 2026-10-20 archives are not reopened. Existing maintained feature/worktree/session/security/testing contracts own their boundaries.

## Architecture

- Explorer owns a captured cwd/directory/context and one upload operation across preflight, conflict choice, XHR and summary. Navigation/unmount invalidates callbacks; dispatched effects are never represented as rolled back.
- Client-safe drop classification and upload transport stay separate from server filesystem helpers. Preserve the image-only composer.
- Server roots and physical containment remain behind `lib/path-security.ts`; session-reference exceptions never grant upload authority. Keep Windows/UNC encoding and canonical checkout identity.
- Existing directory destinations only; dropped directory trees are reported unsupported, not flattened or recursively created. Normal/search tree projections keep separate refresh semantics.
- Overwrite stages bytes in the destination directory, revalidates target/directory and replaces without first deleting the original. OS permissions remain authoritative. External filesystem writers remain a documented race, not an implied transaction.

## Plan

- [x] Implement safe staged upload writes, bounded conflict-preflight parsing and explicit writable refusal; verify synthetic failure/security/API cases.
- [x] Implement target-bound upload lifecycle, file/folder/background drops, folder picker and collapsed-folder invalidation; verify deterministic client/transport/lifecycle regressions.
- [x] Add real packaged desktop/mobile browser coverage for destinations, conflicts, keyboard/touch fallback, dirty watcher state and outside-root denials.
- [x] Update maintained feature/test guides and independently review security and interface behavior; resolve findings.
- [x] Run focused Nix iteration, then complete fresh core/static/plugin, all browser/terminal groups and genuine Home Manager VM acceptance with candidate/input IDs, results, artifacts and timing.
- [x] Commit coherent reviewed history, reassess/rebase current local `rst-main`, and hand off exact verified candidate to the Git lifecycle completion decision. User selected local integration; exact-state merge approval/execution and cleanup remain separate.

## Non-Goals

No recursive folder uploads, composer non-image upload feature, new root admission, live credentials/providers/host service, deployment, remote Git/publication, dependency updates, SDK/runtime/framework changes or unrelated experimental branches. Preserve SDK 1.3.0, Node 24.21.0, Next 16.4.2 and Nix/lock pins.

## Iteration and review evidence

- Initial focused core `/tmp/pi-web-explorer-core.YE6zS4.log` failed (52s command wall): the private test umask masked the fixture's requested `0640` to `0600`. Explicit fixture chmod corrected the expectation, not production behavior.
- `/tmp/pi-web-explorer-core.WOHzdr.log` failed (73s): route VM omitted Node's Buffer global and a live Undici FormData producer rejected after early body cancellation. The fixture now supplies Buffer and serializes its multipart input before dispatch. No application error was suppressed.
- Focused core then passed 6 files / 34 tests in 109s (`/tmp/pi-web-explorer-core.XFvtzh.log`, `/tmp/pi-web-test-core.DCNfUW/run.json`). Backend review subsequently found and corrected cleanup through a swapped parent and unsupported-hardlink compatibility; adversarial sentinel and exclusive-copy fallback tests cover both.
- Focused core passed 6 files / 37 tests in 158s (`/tmp/pi-web-explorer-focused.MslfeI/core.log`, `/tmp/pi-web-test-core.NseOvu/run.json`). The paired browser command was interrupted by the outer tool's 240s limit during prerequisite production realization, before browser assertions. That interrupted preparation is not acceptance. Later browser invocations use an owned background driver so tool-call limits do not interrupt realization; assertion deadlines remain unchanged.
- Browser `/tmp/pi-web-explorer-browser.xV8v75.log` failed in 207s: fixture matched visible text instead of the success count's actual accessible title. Retained screenshot corroborated the successful upload. `/tmp/pi-web-explorer-browser.bV4Qtx/browser.log` then failed in 40s on duplicate destination/path titles; the destination is already fully displayed, so its redundant title was removed.
- UI review corrected Changes-row target routing, keyboard-only folder expansion, matching-search freshness and stale closed-folder loading state. Search remains filtered and uses authorized explicit index refresh; manual refresh receives the same behavior.
- Expanded core passed 7 files / 39 tests in 158s (`/tmp/pi-web-explorer-focused.53Pu7h/core.log`, `/tmp/pi-web-test-core.h8V2t5/run.json`). Its browser snapshot failed in 312s at a duplicate Changed-row title selector, already corrected in the working source while the immutable run was preparing. A response waiter then rejected during teardown; Promise.all now owns action/waiter rejections together. Failed builder `/nix/var/nix/builds/nix-292420-1736795991/build` is retained with uncertain inner settlement, not cleaned or counted as acceptance.
- Actual extracted Explorer owner/input/drop/picker callbacks and TreeNode refresh effect now have context-switch/locking/disposal regressions; they are source-backed VM execution, not a native React renderer. Focused lifecycle/backend/index run passed 4 files / 25 tests in 60s (`/tmp/pi-web-explorer-lifecycle.j5BkZ9/core.log`, `/tmp/pi-web-test-core.XAlKI5/run.json`). Browser acceptance separately exercises mounted ordinary/search/Changes rows, keyboard expansion and touch picker behavior.
- Backend reviewer found no remaining concrete backend defect after corrections; native Windows/UNC filesystem behavior remains unmeasured. New fixtures canonicalize paths, use directory junctions on Windows, gate POSIX-only mode assertions and report unavailable file-symlink privileges without dropping their portable assertions. Linux acceptance must have no skipped cases.

- Browser `/tmp/pi-web-explorer-browser.NgPR6T/browser.log` failed in 168s because Chromium rewrapped DataTransferItems, losing a per-item synthetic directory-method override. The fixture now scopes/restores a prototype override around that one transfer; it does not claim native OS directory dragging. No production workaround was added.
- Settled focused packaged `file-edit` acceptance **passed** desktop 1280x800 and touch-mobile 390x844, including original panel/diff/edit/overflow assertions and all new upload chains: `/tmp/pi-web-explorer-browser.9qVxpD/browser.log`, `/tmp/pi-web-test-browser.YQE4Hl/run.json`, immutable diagnostics `/nix/store/7i5wqxnn366n3s64b5b1hir084580j3c-pi-web-browser-file-edit-diagnostics`. Command wall **67s**, browser capsule **36.263s**; remaining time is not relabeled as an independently measured preparation phase. Successful coverage and settlement were reported. Runtime/test source is now settled for complete acceptance.
- Final client reviewer found no remaining concrete blockers and confirmed the limits of the source-backed VM lifecycle tests. Maintained docs own behavior and limits; dependency/framework/runtime/Nix pins are unchanged.

All times above are command wall times including in-run realization, not pure test-execution benchmarks. Multiple unrelated acceptance runs were concurrently active on the shared 32-logical-CPU host; one observation showed load average 60.57 with about 56 GiB available memory. No live service/providers/credentials, dependency changes, broad console suppression, assertion retries or extended test deadlines were used.

## Risks and Recovery

New directory convenience must not become new write authority. Preflight remains advisory and server writes revalidate. Failed/partial batches and lost responses can have effects: no automatic retry/rollback. Staged overwrite reduces delete-before-write loss but does not lock out arbitrary external writers. Browser folder detection is capability-dependent; reject ambiguous entries conservatively. Preserve dirty drafts/save ownership and stale watcher/probe guards. Local code can be reverted; no stored-format migration or host activation is planned. Retain failed evidence and feature resources until explicitly handled.

## Complete acceptance and handoff

- Accepted application/test commit: **`c5886f0ee74eacf61f77cfb2c561f3d83adab975`**, on local target **`1fe0a04c2d6d11e0c301457e379289d3a61f1508`**. Guarded rebase confirmed it current before acceptance. Subsequent archival/status changes are documentation-only; this is not relabeled as a run on a later evidence commit.
- **`nix run .#test -- all --workers 4 --jobs 4` passed**, **333 seconds end-to-end command wall time** (5m33s), including in-command realization. Native x86_64 Linux, 32 logical CPUs/about 59 GiB available before admission; the recorded combined estimate is 16 CPUs/27 GiB, not a reservation. Requested/effective widths were **four browser sandboxes/four core workers**. Other shared-machine activity had eased before launch; prerequisites were warm from the documented focused runs, with no additional prewarming. All test executions were fresh, not a cold-cache or machine-exclusive benchmark.
- Outer evidence: `/tmp/pi-web-explorer-all.voTTg9/all.log`; verified snapshot `/tmp/pi-web-test-source-8qZDYI`, `selection.json`, content/mode SHA-256 **`be12762771da88859fc335a9ff71e293111f2fda6c34d02532d1c2185f1bf5c1`**. Core-filtered digest **`2be2b564ee3054380af636e43bad933cbf0e11c86f07873e6263f10acb8700c6`**.
- **Core/static/plugin:** all **349 files / 2,632 tests / 12 suites** passed, zero failed/skipped/cancelled/not-started; no observed surviving owned processes or uncertain settlement. `/tmp/pi-web-test-core.kFe8gh/run.json`; immutable output `/nix/store/24b4jv1xxmvf4nbazgc0mp73vgvp1v1z-pi-web-core-checks`. Inclusive level interval **308.199s**; realization/static preparation through first file **49.021s**; file-execution span **258.839s**. Existing unrelated ReviewFileBrowser ref lint warnings remain warnings.
- **Browser/terminal:** all **24 groups / 53 exact scenario receipts** passed with matching expected/completed coverage, artifacts, settled clients/processes and closed ports. `/tmp/pi-web-test-browser.h9WgcO/run.json`; settled-candidate file-edit output `/nix/store/xd3jvwvm0j880yn3qqjrgx52fhpm62am-pi-web-browser-file-edit-diagnostics`. Inclusive browser-driver interval **261.721s**; before-first-capsule interval **7.124s**; inner-capsule timestamp span **254.477s**, not a sum of parallel group durations.
- **Genuine deployment VM:** `/tmp/pwv-rpIJDp/run.json` passes real Home Manager/default-target activation, private environment/permissions, durable HTTP writes, restart persistence, real HTTP PTY and collection/settlement proofs. Final guest service inactive/dead, MainPID zero, authenticated cgroup absent, port refused. Inclusive service interval **64.566s**, guest evidence **19.804s**; the difference is not an independently measured build phase. Browser and guest use the same production package `/nix/store/039aijgq7pcd2n3f6s55vv5wph3xg588-pi-web-0.9.3`. Core overlaps browser/deployment; do not add level intervals to command runtime.
- Full acceptance includes the final lifecycle regression fixture. Original failures and uncertain/interrupted evidence remain retained. No assertion deadline, inventory owner, general console/5xx handling, dependency/framework/runtime pin or host installation changed. Nix ignored one source-local eval-cache SQLite busy diagnostic; all declared verdicts passed.
- Backend and client reviews have no remaining concrete blockers. Native Windows/UNC filesystem behavior and native desktop OS drag gestures remain unmeasured; browser transfers and capability-dependent directory entries are synthetic. Source-backed VM callback tests are not a native React-renderer proof. External filesystem writers remain a documented final-check/effect race.
- User selected **Integrate into local `rst-main`** through `ask_user` after full acceptance. This archive completes the implementation/verification handoff, not the merge: the Git lifecycle owns exact-state approval, unsigned non-FF execution, result verification and separately approved cleanup. No remote publication or installed-host deployment/restart was authorized or performed.

## Completion Checklist

- [x] All approved interactions have meaningful synthetic and real-browser evidence, including failure and reference-only write refusal.
- [x] Independent review resolved and complete Nix acceptance recorded for settled application/test inputs.
- [x] Maintained guides own ongoing behavior; implementation evidence is ready for archival and exact-state Git handoff.
