# Cleanup artifact approval

## Goal

Make integrated-worktree cleanup usable with ordinary generated directories and files. Support both explicit one-time approval and a reusable user-owned allowlist, without granting deletion authority from ignored status or model arguments.

Implementation authorized by the user's selection of both behaviors. Isolated branch `fix/cleanup-artifact-approval` starts at local `rst-main` `116dc5e09d323dbeabfce8784603d829a44541c1`. Integration, deployment and deletion of the example worktree are separate lifecycle decisions.

## Context and Plan Relationship

Follow-up to `2026-10-08_session-git-policy-plan.md` and ADR 0016, not a new owner of settings resolution or generic receipt infrastructure. The original implementation is integrated; its claim that normal artifacts can be cleaned needs qualification: session `01a11bfd-8c1e-740e-bb50-a9129468b55c` supplied `artifactRoots: []` and failed with `Unknown cleanup resource: .codegraph` before any effects. `.codegraph/`, `.next/`, `node_modules/`, `test-results/`, and the unsupported regular file `next-env.d.ts` remain. This was a preflight refusal, not a hung native operation.

The user selected both one-time approval and a reusable file/directory allowlist. A new ADR revises only ADR 0016's setting-only artifact authority.

## Architecture

- Retain `artifactRoots` and `approvedArtifactRoots` for compatibility; accept literal top-level regular files as well as directories.
- When removing a worktree, discover top-level ignored artifacts server-side. Unignored untracked paths still require explicit selection; tracked/dirty source and mixed tracked roots remain protected. Discovery is a proposal, never permission.
- Inventory all proposed resources before approval. If any artifact lacks the effective user-owned allowlist entry, require one live explicit approval even when `cleanupFeature` is Allow. Ask combines artifact and operation approval in a single card. Deny/Keep remain authoritative.
- Freeze the candidate paths after preparation. Revalidate content, identity, policy and remaining resources before effects. New files cannot be silently swept into deletion. Preserve managed-directory reservations, bounded inventories, mount/nested-repository/symlink-root rejection and partial-effect reporting.
- Record truthful effective Ask/user-approved authorization for the one-time exception, keeping configured permission provenance visible. Do not modify settings or add a model-facing permission writer.

## Non-Goals

No blanket ignored-file authority, force removal, recursive glob allowlist, automatic configuration writes, remote effects, activation, or cleanup of the reported example worktree. No generic UI permission editor inside approval cards. Existing strict `git_worktree` removal and standalone CLI behavior remain unchanged.

## Plan

- [x] Extend artifact capture/removal to regular files and bounded ignored-root discovery; verify positive and safety regression tests.
- [x] Add single-card one-time artifact authorization under Ask/Allow and truthful receipts; verify cancellation, rejection, staleness and settings behavior.
- [x] Update setting/tool guidance, focused guide, repository instructions and superseding ADR 0017.
- [x] Add original-session regression and desktop/mobile browser acceptance for discovered artifacts and saved receipts.
- [x] Run full core tests, typecheck/lint and separate plugin tests; record results without production builds.
- [x] Review changes and hand off the verified implementation to the normal Git lifecycle. Local commit/integration/cleanup are owned by the live Git operations and their receipts, not this implementation plan; they remain separate from deployment and example-worktree deletion.

## Risks and Recovery

Ignored files can contain valuable data: list exact top-level candidates and sizes before granting one-time authority; no Allow bypass for unlisted roots. External writers remain uncoordinated. Deletion has no rollback; stop on changed state and honestly report partial outcomes. Preserve feature resources on failure. This source change does not alter installed tools or settings until separately deployed.

## Verification and Review (2026-10-08)

- Full isolated `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`: **262/262 files, 1,677 tests passed**, typegen/typecheck/lint passed, zero observed surviving processes (`/tmp/pi-cleanup-artifact-offline-complete.log`). An earlier outer tool timeout interrupted a run; no test deadline was changed, and its log is retained at `/tmp/pi-cleanup-artifact-offline.log`.
- Literal `npm test`: **1,683 passed**; `node_modules/.bin/tsc --noEmit` and `npm run lint`: passed with disposable HOME/config/TMP and bounded CPU affinity (`/tmp/pi-cleanup-artifact-baseline.log`).
- Separate `node --experimental-strip-types --test "plugins/**/*.test.mjs"` in sanitized offline Nix environment: **119 passed**, including **80 cleanup tests** (`/tmp/pi-cleanup-artifact-plugin-suite.log`).
- `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e` in sanitized Nix Chromium environment: **1280px and 390px passed**, including discovered files/directories, single live approval under Allow, rejection, unchanged settings, reload/reconnect and durable read-only receipt (`/tmp/pi-cleanup-artifact-browser-retry.log`). Initial run failed with ECONNRESET during `get_tools`, before cleanup; independent investigation found no backend error or process-collision evidence. An unchanged rerun passed. Root cause is not proven fixed; initial evidence retained at `/tmp/pi-cleanup-browser-first-sfujS8` and `/tmp/pi-cleanup-artifact-browser.log`.
- Independent safety review identified case/trailing-dot aliases that could produce an empty artifact inventory while pointing at tracked source or `.git`. Fixed by exact top-level entry spelling, conservative tracked-root/metadata alias rejection and nonzero inventory verification. Linux regressions cover these guards; no native case-insensitive host test was performed.
- `git diff --check`: passed. No terminal integration inputs changed; no production build or installed service/skill/settings mutation occurred.

Current behavior and rationale are owned by `docs/git-workflow-plugin.md`, `AGENTS.md` and ADR 0017. External-writer races and live-model adherence remain outside this acceptance; the reported example worktree has not been deleted.

## Completion Checklist

- [x] Original example can reach an approval without manual settings editing and can include `next-env.d.ts` (reproduced with isolated fixtures, not deletion of the real worktree).
- [x] Explicit reusable file/directory entries work; unknown artifacts never inherit automatic Allow permission.
- [x] Rejection, missing browser UI, changed resources/policy and existing protected states produce no unintended effects.
- [x] Focused/full verification and browser results are recorded; unresolved limitations are disclosed.
- [x] Durable behavior lives in maintained docs/ADR; integration and cleanup status are reported separately.
