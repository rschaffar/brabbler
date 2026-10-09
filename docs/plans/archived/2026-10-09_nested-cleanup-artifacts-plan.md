# Exact nested cleanup artifacts

## Goal

Allow cleanup of exact nested generated files/directories such as
`src/meetings/__pycache__` without selecting tracked parents or weakening approval.
Implementation is authorized by the user's `implement` request. Work starts in
`fix/nested-cleanup-artifacts` from local `rst-main`
`e4ca21d914b0c49f44dbb5f3e50a0d60a1e82a56`. Deployment, remote publication and
cleanup of the original meetings worktree are outside this task.

## Plan Relationship

Extends ADR 0017 and its archived cleanup-artifact implementation; the active
session-Git-policy plan retains its separate historical integration obligation.
A new ADR revises only the top-level-path restriction. No managed Workflow revival,
settings migration, wildcard authorization or permission changes.

## Architecture

Keep all semantics in the Git plugin. Use literal slash-delimited relative roots;
reject aliases, traversal, overlap, tracked contents and unsafe ancestors. Discover
Git's exact ignored paths without promoting them. Fingerprint selected subtrees
separately from source; direct-parent timestamps/size are stored separately and
remain strict until their approved child is deleted. Identities, modes, source/file
contents, entry structure and unaffected metadata stay bound. Each inventory still
rejects concurrent metadata changes; frozen parent coverage survives deletions.
Hold captured ancestors through Linux no-follow directory handles across nested
removal; unsupported platforms/proc configurations refuse before approval.

## Plan

- [x] Extend path validation/discovery and inventory ownership; verify with focused cleanup integration tests.
- [x] Add regressions for nested directory/file approval, rejection, allowlists, aliases, unsafe ancestors, overlap, staleness and multiple deletions.
- [x] Extend desktop/mobile cleanup browser fixtures with nested caches beside tracked source.
- [x] Update tool/policy/settings guidance, maintained guides and a revising ADR.
- [x] Complete independent safety review, full Linux offline baseline, separate plugin tests and plugin-only desktop/mobile browser acceptance; retain exact logs/artifacts.
- [x] Commit coherent changes and resolve completion preparation; hand remaining exact-state integration/cleanup to this session's guarded Git-tool lifecycle and durable receipts, not this implementation plan.

## Verification checkpoint

Tested the working filesystem on base `e4ca21d914b0c49f44dbb5f3e50a0d60a1e82a56`.
Final runtime files `cleanup.ts`, `cleanup-path.ts`, `index.ts`, `manifest.ts` and
`policy.ts` match the final offline source export byte-for-byte. Subsequent changes
are test-fixture/test-only additions and this evidence; they have their own checks.
No production build or installed-service contact.

- Full baseline: `nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs`
  passed **267 files / 1,716 tests**, typegen/typecheck/lint. Runtime **137.05 s**;
  log `/tmp/pi-nested-cleanup-offline-final.fsoRMz.log`; retained source/export bulk
  `/tmp/pi-web-test-offline.cUHKIsYY`, artifacts `artifacts/run-qMALjm` below it.
- Final separate plugin selection: `nix develop --offline --no-write-lock-file -c sh -c
  'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test
  "plugins/**/*.test.mjs" && node_modules/.bin/eslint e2e/git-workflow-plugin.mjs'`
  passed **185 tests** and final browser-fixture lint, **79.89 s**;
  log `/tmp/pi-nested-cleanup-plugin-tip.LAAZ21.log`.
- Plugin-only browser command from the owning guide, with
  `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1`: **1280px / 390px passed**, **352.63 s**;
  log `/tmp/pi-nested-cleanup-browser-one-shot.r6zbhV.log`; retained artifact
  `test-results/e2e/browser-Nhac41`, fixture `/tmp/pw-browser-6U0LjD`.
  Manifest reports passed, no errors, settled owned server/group.
- Dependencies were prepared before these acceptance runs. Command times above
  include cached shell entry, not initial preparation/model/review/coordination time.
- Independent read-only review found ancestor-substitution and hidden invalid
  explicit-child risks. Both fixed, regression-tested and re-reviewed with no new
  actionable findings. No-follow descriptor closure and missing capability refusal
  have dedicated tests. A filesystem mock initially missed Jiti's captured imports;
  fresh module evaluation makes the boundary regression execute the real mock.

### Preserved failures and fixture adjustments

- Initial focused assertions used the wrong receipt effects field and a superseded
  refusal message: `/tmp/pi-nested-cleanup-focused.N5mPBF.log`; corrected, not suppressed.
- Browser `browser-T5YNgq`, fixture `/tmp/pw-browser-wNahmK`, expected a nested cache
  label while Git also reported its generated-only parent. Added a tracked sibling
  to enforce the intended source-adjacent fixture; did not change discovery semantics.
- Browser `browser-qkVj9k` / `/tmp/pw-browser-AjHoKw` and diagnostic `browser-12iLNa` /
  `/tmp/pw-browser-J1W5bs` exceeded the unchanged 30-second assertion for eight roots.
  Diagnostic markers showed all eight deletions completed and final validation still
  running; markers were removed. The same eight-root real-Git regression passed in
  **2.54 s** (`/tmp/pi-nested-cleanup-mixed.H3WOM3.log`). Browser coverage now uses two
  separately asserted five-root scenarios, retaining all original build-output
  coverage and adding a mixed nested-cache case; no deadline or safety check relaxed.
- Browser `browser-RCYOGW` / `/tmp/pw-browser-ZmKQH9` and `browser-GF9HuU` /
  `/tmp/pw-browser-8QKcax` failed on an API-test `get_tools` connection reset before
  cleanup. No application exception or unexpected server exit was observed.
  One-shot API-test probes now request `Connection: close`, without retry/error
  suppression. The later pass does not establish the original transport root cause.
- Failed-run `.next` trees are retained under `/tmp/pi-nested-cleanup-next-backup.`
  suffixes `qSFVTv`, `CmFpP6`, `tOSvJS`, `yIVrC5`, `rXxs3w` (each contains `.next`).
  Every move followed manifest settlement and absence of the recorded Next PID.
  All listed diagnostics/fixtures/backups remain retained, not cleanup-authorized.

Local `rst-main` advanced to `ad54111d533cd7038c220314916a1550dfec7628` during
validation. Integration preparation must rebase/reassess that resulting candidate;
these runs are not new-target acceptance. Completion intent and exact-state merge
approval remain pending. The installed service and original meetings resources
are untouched.

## Rebased acceptance and lifecycle handoff

The user requested rebase first because `rst-main` moved. Feature commit
`c690f4451fc554658aed27a42651e3ba5fa15987` rebased cleanly to
`cba8575abb1ce62c2f5a9ca3c7a7dc783c6635fc`, directly above local target
`05f3f264d88bb6ab561780046ec491d0e4c9ed83`. `git range-diff` reports the
feature patch unchanged. Target changes include Pi runtime 1.1.0 dependencies;
all required acceptance was rerun rather than reusing the earlier checkpoint.

- Old dependencies/browser cache retained in
  `/tmp/pi-nested-cleanup-rebase-backup.BcKZjt`, no disposal authorized.
  Dependency preparation took **8.47 s**, log
  `/tmp/pi-nested-cleanup-rebase-prep.teKktQ.log`. Its trailing version probe
  failed because `package.json` is not an exported package subpath; preparation
  itself succeeded, and the subsequent matching-shell acceptance entry succeeded.
- Same full baseline command: **267 files / 1,718 tests**, typegen/typecheck/lint
  passed, **131.16 s**; log `/tmp/pi-nested-cleanup-rebased-offline.DAnfyR.log`;
  export `/tmp/pi-web-test-offline.hDPScv9o/source`, artifacts
  `/tmp/pi-web-test-offline.hDPScv9o/artifacts/run-XNmssj`.
- Same separate plugin command (without the separately unnecessary extra lint):
  **185 tests passed**, **86.32 s**; log
  `/tmp/pi-nested-cleanup-rebased-plugin.FEpTtx.log`.
- Same plugin-only browser command: **1280px / 390px passed**, **378.45 s**;
  log `/tmp/pi-nested-cleanup-rebased-browser.gjtdzz.log`; artifacts
  `test-results/e2e/browser-CGii6E`, fixture `/tmp/pw-browser-dusDMd`.
- Checkouts clean after acceptance; patch whitespace check passed. The following
  archival/evidence-only commit changes no application, dependency or test inputs;
  its own checks are documentation review and patch/input identity checks.

Implementation is verified and handed off to ADR 0019 and the maintained cleanup
and feature guides. This session owns the remaining separate exact-state local
integration approval, result verification and cleanup gates, recorded by the Git
tools' durable receipts. They are not pre-approved by plan archival. No deployment,
remote publication or original meetings cleanup is included.

## Risks and Recovery

Nested deletion must never follow symlink parents, sweep tracked siblings, or accept
new artifacts after approval. External filesystem writers remain uncoordinated;
refuse observed changes and report partial effects without rollback. Revert source
changes through normal review if needed; receipts and existing settings remain
compatible and are not deletion authority. Installed runtime is unchanged until a
separately authorized deployment.

## Completion Checklist

- [x] Exact nested cache paths reach one approval card and cleanup succeeds with tracked siblings intact.
- [x] Negative cases retain unsafe/unapproved resources and report honest outcomes.
- [x] Required checks and review pass; candidate/commands/results/artifacts recorded.
- [x] Feature commit/rebase/acceptance documented; separate remaining integration/cleanup has one explicit current owner (this session's guarded Git lifecycle and receipts). No remote publication or deployment.
