# Close authentication and transcript file-reference bypasses

## Goal

Fix both confirmed security findings in one feature worktree, preserving immutable Nix deployment and intentional file links. User authorized implementation; remote operations, publication and host deployment remain outside scope.

## Context and Plan Relationship

Base: `6bc2c3f42b50ce3771af297a875cb14c4656de0e`. Worktree: `/home/robert/projects/3rdparty/pi-web-worktrees/security-boundaries`, branch `fix/security-boundaries`. The parent session is the sole writer and test coordinator; two read-only reviewers inspect independent security boundaries in this same worktree. No active plan owns these two findings. The preceding upstream easy-wins implementation is complete and archived.

This implementation plan ends at a verified integration handoff. The global Git lifecycle owns completion intent, exact-state merge approval/execution and separate cleanup, recording actual outcomes through durable operation receipts. No archive/evidence entry claims an unexecuted merge or deployed fix.

## Findings

- Pinned Next 16.4.2 skips proxy middleware when an incoming revalidation header matches the build preview ID. Authentication lives in that proxy; the distributed immutable package includes the build manifest. Upstream startup rotation cannot rewrite the Nix store and warns rather than failing closed.
- The external-file reference collector treats arbitrary transcript strings as authority. System messages, unrelated tool results and custom data can therefore bypass the root allow-list. Intentional user/assistant links and appropriate coding-tool output must remain usable.

## Plan

- [x] Select and document a Nix-compatible request-boundary mitigation before Next can skip authentication; independently review launch paths, process lifecycle and failure behavior without reading live manifests or probing the host service.
- [x] Implement the mitigation on supported installed/npm/development entrypoints without modifying immutable artifacts; verify mixed-case/duplicate/malformed bypass headers and normal request/lifecycle behavior with synthetic core fixtures.
- [x] Replace unrestricted reference collection with an explicit message/tool policy; verify rejected system/custom/context-edit/untrusted-result paths and retained intentional links, coding/subagent output and recognized nested calls against SDK 1.3 shapes.
- [x] Add safe route and genuine installed-package regressions for both boundaries, using disposable synthetic files/data and immutable package identity, never live credentials or the host service.
- [x] Update owning security/feature/dependency guides and an ADR for the selected launch boundary; document limits, unsupported invocation paths and deployment requirements accurately.
- [x] Obtain independent reviews of the actual patch and resolve concrete findings before settled-candidate acceptance. Both read-only reviewers reported no remaining scoped security findings after code, fixture and documentation corrections.
- [ ] Run focused Nix checks during editing, then complete fresh core/static/plugin, all browser/terminal groups and genuine Home Manager deployment VM acceptance; retain exact candidate/input identity, commands, result, runtime and artifact paths.
- [ ] Reassess/rebase onto the current local `rst-main` and deliver the clean verified candidate for the Git lifecycle's exact-state completion decision.

## Selected implementation and focused evidence

- The selected early Node preload intercepts only HTTP/HTTPS server dispatch before Next; supported npm scripts bootstrap the same guard and propagate its absolute path through the pinned Next dev-worker formatter. No manifest rotation, secret extraction, custom-server rewrite or store mutation. ADR 0026 owns the durable mechanism and limitations.
- The explicit reference-source extractor separates prose from literal paths; literals use `samePath`. SDK 1.3 `NestedToolCalls` and `BashToolDetails.fullOutputPath` were checked against public installed declarations. Generic custom/receipt/system/context data never grants access. Recognized coding output text remains an explicit compatibility concession.
- Independent review corrected upgraded-socket half-close retention, native Expect 417/100 assumptions and prose interpretation of literal filenames. Regression cases cover those corrections.
- Initial focused core failed because the raw duplicate-header fixture omitted Host and received Node's own parser denial instead of the expected guard headers. Native unsupported Expect handling was also corrected. Original evidence: `/tmp/pi-web-security-core.lr7tPG.log`, `/tmp/pi-web-test-core.k5ehi3/run.json`, failed derivation `/nix/store/qy1f4abh2dhja9gd4ms3n23p3rdj3h8q-pi-web-core-checks.drv`. No application error suppression or deadline increase.
- `nix run .#test -- core --jobs 2 --file lib/pi-web-node-args.test.mjs --file lib/request-header-guard.test.mjs --file lib/session-file-references.test.mjs --file lib/session-file-reference-policy.test.mjs --file app/api/files/reference-authorization.test.mjs` passed **5 files / 43 tests** in **40 seconds command wall time**, including static preparation; `/tmp/pi-web-security-core.KcGqTu.log`, `/tmp/pi-web-test-core.Nomh3S/run.json`.
- Two independent one-worker browser sandboxes were admitted with writers paused during export. Installed state/header acceptance passed: `/tmp/pi-web-test-browser.HARKms/run.json` (6.641 seconds capsule execution). Markdown initially failed because the exact readiness inventory omitted the five new UUID fixtures; evidence `/tmp/pi-web-security-browser.HdwoMH/markdown.log`, `/tmp/pi-web-test-browser.Xq6sl8/run.json`. The assertion was extended with exactly the new fixture IDs, not weakened.
- Corrected `nix run .#test -- e2e --group markdown` passed desktop/mobile real API denials, intentional external reads and rendered source links in **68 seconds command wall time**, **57.347 seconds capsule execution**; `/tmp/pi-web-security-markdown.pbMyyJ.log`, `/tmp/pi-web-test-browser.lbBoKt/run.json`, outer digest `03136dd2d5a652e0b1b1f394fb2e3b4858c653ec0af9ee156be690f5b2c4b1f5`.
- Interactive opening of the external viewer is not claimed by this new regression: its pre-existing edit/Git capability probes legitimately return 403 outside roots. No generic console exemption or unrelated viewer refactor was added. Core and genuine HTTP prove reference-only files remain non-editable/non-listable.
- CodeGraph became unavailable after the harness restart (CLI exited 139); direct source tools were used without reinitializing other checkouts.

## Non-Goals

No live service probing/restart, credential inspection, preview-secret extraction, network exposure changes, provider permission expansion, upstream dependency downgrade, general prompt-injection claim or unrelated feature backport. Root authorization and Windows/UNC identity remain centralized; external-reference viewing remains read-only.

## Risks and Unknowns

The request-boundary mechanism must precede framework header handling and survive supported child-process startup, not merely run inside the bypassable proxy. Preserve Node/Next CLI signal/readiness behavior. File-policy narrowing can reject historical incidental links; prefer explicit authority over opaque receipt/custom data. Nested tool-call schemas and namespace aliases require verification rather than suffix-based tool-name trust.

## Rollback / Recovery

No persistent data migration or manifest rewrite is planned. Reverting the code restores the vulnerable behavior and is not a security mitigation. Deployment remains a separate explicit operation; until fixed code is deployed, existing running instances retain the old behavior. Failed checks and feature resources are retained, not erased for convenience.

## Completion Checklist

- [x] Both bypasses are closed on supported entrypoints with meaningful focused adversarial regressions and documented boundaries; full acceptance remains separate below.
- [ ] Independent review findings are resolved and complete acceptance passes for the settled candidate.
- [ ] Durable mechanisms/limits live in maintained guides; final evidence and exact source/target IDs are recorded.
- [ ] Verified candidate is handed to the Git lifecycle without publication or host deployment.
