# Settings-first MCP defaults

## Goal

Replace the text-heavy whole-selection default controls with Settings → MCP servers. Each global server has an independent switch; each project server has Use global / On / Off. Keep only current-chat selection and a Manage defaults link in the compact chat picker. Code-mode defaults live separately in General settings.

## Context

The preceding global-default delivery is integrated, but its UX and whole-selection model are explicitly superseded by this approved follow-up. Its archived test record remains historical, not a design endorsement.

## Plan

- [x] Add independently resolved per-server preferences and Code-mode preference with bounded private persistence, revision conflicts and project identity checks. Preserve legacy snapshots as a fallback; verify native migration, off/inherit, exact declaration ownership and independent edits.
- [x] Add no-project global metadata and per-field autosave API, without transports, trust grants or wrapper changes; verify security, validation and ordinary-session admission.
- [x] Add compact Settings controls and chat-to-settings navigation, removing default editing from chats. Verify actual mounted controls, stale/failed acknowledgements, scope changes and preserved current-chat behavior.
- [x] Update owning guides and test dispositions; independently review and run complete Nix acceptance on the final candidate before local integration approval.

## Architecture

Extend the existing version-1 private store with optional global/project preferences. Retain old snapshots, including their implicit off entries, rather than enumerating the current catalogue and silently granting future servers. Explicit per-server inherit restores the global choice even over a legacy project snapshot. Server namespace identity merges hyphen/underscore aliases, but an enabled choice retains exact declaration scope/name. Missing/replaced declarations never become another grant. Code-mode inherits independently. Ordinary creation alone resolves defaults into immutable session intent.

## Non-Goals

No MCP command/URL/secret editor, OAuth, profile-controlled child/launch grants, retrofit of existing chats, host deployment or remote publication.

## Rollback / Recovery

Legacy snapshots remain readable and unchanged during metadata/startup. Scoped writes preserve unrelated settings under the same lock. Unconfirmed writes lock editing until an explicit metadata refresh; never replay automatically. Corruption fails closed; explicit session off still bypasses a broken default lookup. Existing chats retain saved intent.

## Test dispositions and focused evidence

Original assertion coordinates below refer to integrated base `c303bdfa774f1c760e3b1659bd28c5751c80a2f6`. Removing session-dialog default editing deliberately retires its placement/whole-selection-payload assertions, not the underlying safety obligations.

| Original owner | Disposition |
| --- | --- |
| `components/SessionToolsControl.behavior.test.mjs:82–193` | Replace whole-selection Save/Clear controls with actual mounted Settings per-server autosave, project inheritance, no-project Global, exact replacement display, Code-mode separation, lost/contradictory/stale ACKs, explicit refresh without replay and obsolete-context completion tests. Compact-picker Apply/busy/current-callback/inertness remain; add default-navigation and A/B/A directory fencing. |
| `hooks/useAgentSession.native-control-composition.test.mjs:224–276` | Retire the two default-clear composition cases because that control no longer exists in the hook/chat owner. Settings owns their ACK policy; native API tests retain real persistence, inert writes and existing-chat separation. Preserve preceding actual hook Apply/OTHER-busy/draft/transcript/identity/explicit-refresh cases. |
| `e2e/native-tools.mjs:176–193,203,226–265` | Move actual save/reset actions to Settings per-server On/Use global and global switch. Retain native stdio/QuickJS, unrelated-busy-session independence, linked-worktree default inheritance, fresh-composer opt-out before any connection, existing-session snapshots and genuine global fallback. No scenario/input chains are removed. |
| `e2e/native-tools-layout.mjs:33–39` | Replace dialog global-save geometry with chat-to-Settings navigation, reachable server switch and collapsed details at touch width. Keep actual native modal focus/Escape/Apply reachability and draft retention. |

- Initial six-file focused Nix core selection: **59 tests passed**, **49 seconds** including realization, plus static checks. Initial installed native-tools desktop/mobile group: **passed**, **91 seconds** including realization; screenshots were inspected, leading to styled scope-button refinement.
- Independent review identified exact-reference display ambiguity, capacity recovery and late-current-chat Apply context fencing. New native/mounted regressions exercise these paths. A later mounted test failure asserted state on a checkbox correctly removed from the DOM; it now asserts detached identity rather than stale node state.
- In a private source-only copy, deliberately restoring namespace-only legacy On projection failed the new exact-scope/spelling assertion: **15 passed / 1 failed**, **43 seconds**. The receiving worktree was never mutated by this fault. Original fault/source/log evidence is retained privately.
- Final focused native store/API/mounted Settings selection: **39 tests passed**, **50 seconds** including realization, plus static checks. This includes progressive **130 → 129 → 128** repair with persistent warning until the final acknowledged reduction.
- Independent review is closed with no remaining blockers. An initial full acceptance run was deliberately interrupted after **96 seconds**, before changing the candidate, when cross-tab directory coupling was identified. Separate `defaultsCwd` now follows the workspace for MCP/Code-mode only, retaining existing model/account cwd/session bindings. The actual SettingsPanel regression passes **19 tests**, **44 seconds** including realization. Two earlier failures were test-fixture query-shape mistakes (its recorded queries are sorted entry arrays), not product failures; their original diagnostics are retained. The next complete run passed **534 files / 4,639 tests** but failed the native-tools browser flow in **355 seconds**: the new current-chat epoch guard incorrectly treated draft-to-created session ID adoption during Apply as navigation, leaving its modal open after successful creation. This is a real regression, not an unchanged timing retry. The guard now permits only its own first ID adoption in the same directory; directory/later-ID changes remain fenced. A mounted mid-await adoption regression and the existing real hook controls pass **19 tests** (**54 seconds**); the genuine desktop/mobile native-tools group passes **9.323 seconds** execution (**91 seconds** including realization). The subsequent complete result is recorded below. Private task evidence retains original failures and manifests outside the repository; maintained behavior is documented in `docs/native-session-tools.md`.

## Final acceptance

`nix run .#test -- all --workers 4 --jobs 12` passed on the corrected candidate in **448 seconds** end-to-end, including in-run realization. Verified source content/mode SHA-256: `99b9d5191c227e7f96937176e5705c0b5dd6484fd7ddf7a1fe15e37bfa0f5456`, based on local main `c303bdfa774f1c760e3b1659bd28c5751c80a2f6`. Subsequent changes are documentation/evidence archival only.

- Complete scope: **534 core files / 4,640 tests**, type generation/typecheck/lint and bundled plugins; **all 26 browser/terminal groups**; genuine Home Manager deployment VM including converter coverage. No skipped/cancelled/failed core tests or reported surviving observed processes/uncertain settlement. The corrected native-tools browser group passed **11.784 seconds**. Desktop screenshots were inspected; touch tests retain actual Settings control bounds and modal/draft behavior.
- Requested/effective widths: **12 core / 4 browser**, overlap admitted on x86_64 Linux, Node 24.22.2, 32 CPUs and approximately 46 GiB available memory. The core runner independently confirmed effective width 12. Earlier focused checks prewarmed prerequisites; no cold-cache performance claim is made.
- Browser prerequisite preparation: **9.197 seconds**; group execution window: **319.427 seconds**. Core level: **391.951 seconds**, inner pipeline **336.455 seconds**. Deployment level: **111.733 seconds** including realization; VM script **53.23 seconds**. These overlapping intervals are not additive and exclude model/review/approval time.
- Retained core output: `/nix/store/ipkapg83aidkbszvdknvzhmw9k8js599-brabbler-core-checks`; native browser capsule: `/nix/store/sn7hw2yndar32mjk24xy2qn4j5mqz6wr-brabbler-browser-native-tools-diagnostics`. Private task evidence retains all-level manifests, original failures, source-only counterexample and screenshots outside the repository.
- Independent source review is closed, including exact grant display, progressive overflow recovery, separate workspace versus account bindings and creation acknowledgement fencing. Current behavior belongs in `docs/native-session-tools.md`, `docs/session-internals.md` and the source map. Implementation/verification are complete; exact-state local integration, resource cleanup, deployment and publication remain separate native-policy operations.

## Completion Checklist

- [x] Native store/API, mounted Settings/chat controls and installed desktop/mobile bridges pass, including meaningful runtime counterexamples for changed policy.
- [x] Full static/core/plugin, browser/terminal inventory and genuine deployment VM acceptance pass with recorded input identity, budgets and timings.
- [x] Maintained guides own current behavior and exact-state local integration remains separately approved.
