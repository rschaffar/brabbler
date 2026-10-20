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
- [ ] Run focused Nix iteration, then complete fresh core/static/plugin, all browser/terminal groups and genuine Home Manager VM acceptance with candidate/input IDs, results, artifacts and timing.
- [ ] Commit coherent reviewed history, reassess/rebase current local `rst-main`, and hand off exact verified candidate to the Git lifecycle completion decision. Integrate only with exact-state approval; cleanup remains separate.

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

## Completion Checklist

- [ ] All approved interactions have meaningful synthetic and real-browser evidence, including failure and reference-only write refusal.
- [ ] Independent review resolved and complete Nix acceptance recorded for settled application/test inputs.
- [ ] Maintained guides own ongoing behavior; implementation evidence is ready for archival and exact-state Git handoff.
