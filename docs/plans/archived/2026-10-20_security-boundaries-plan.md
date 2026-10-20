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
- [x] Run focused Nix checks during editing, then complete fresh core/static/plugin, all browser/terminal groups and genuine Home Manager deployment VM acceptance; retain exact candidate/input identity, commands, result, runtime and artifact paths. See final acceptance below.
- [x] Reassess/rebase onto current local `rst-main` and deliver the clean verified candidate for the Git lifecycle's exact-state completion decision. `git_rebase` preserved the unrelated live-prompt session-action fix and produced the tested candidate on target `d8888f5`. The user selected local integration after acceptance; exact-state approval/execution remains with the merge tool.

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

## Final acceptance and integration handoff

Tested source: `33c4c4bb603663677a73ae1024706e6fc34682be`, rebased from source commit `d9a98b1a0c53d5730a2104bbdbe60e4bcf5aa675` onto local target `d8888f5510113b7ce696df9624f20906469c7e93`. `nix run .#test -- all --workers 2 --jobs 2` passed with fresh execution in **556 seconds command wall time** (9m16s), including realization and separate from model/review/coordination work. The two-worker budget intentionally bounds concurrency; this is not a cold-cache benchmark or a timing comparison with earlier four-worker runs.

- Outer content/mode digest: `c05fe6aa3b15908fd23c60c98fc567aeb624d641d42cffef83dcee4f98f60696`; snapshot `/tmp/pi-web-test-source-lQXq2n/source.json`, selection `/tmp/pi-web-test-source-lQXq2n/selection.json`.
- Core/static/plugin: **318 files / 2,494 tests / 10 suites**, no failures, cancellations or skips. `/tmp/pi-web-test-core.rzGxj3/run.json`, immutable output `/nix/store/qa08ki0lvlmpx3zdi5wsfvaqqfqr574g-pi-web-core-checks`.
- Browser/terminal: **all 24 groups / 53 exact scenario receipts**, all passed and settled. `/tmp/pi-web-test-browser.ooumKO/run.json`. Pre-first-capsule preparation/coordination interval 80.728 seconds; capsule execution span 403.304 seconds.
- Genuine Home Manager deployment VM passed activation, permissions/environment, durable writes/restart, actual HTTP PTY and shutdown/collection proofs. `/tmp/pwv-tOurEp/run.json`; 64.866 seconds including realization/collection, with 18.708 seconds reported execution.
- Full command log `/tmp/pi-web-security-all.XdjAwz.log`. Core/browser overlap, so intervals must not be summed. Complete acceptance includes the unrelated target fix; earlier focused passes are not relabeled as rebased-candidate runs.
- Final independent reviews found no remaining scoped findings. Maintained contracts and ADR 0026 own the mechanism/limits. The implementation plan's archival is documentation-only; application and test inputs remain those accepted above and receive an exact diff/whitespace check before integration.
- User selected **Integrate into rst-main** after this acceptance. Required unsigned non-FF merge, its exact-state approval and separate cleanup remain subsequent Git lifecycle operations. No host deployment, service restart, remote operation or publication was performed.

## Non-Goals

No live service probing/restart, credential inspection, preview-secret extraction, network exposure changes, provider permission expansion, upstream dependency downgrade, general prompt-injection claim or unrelated feature backport. Root authorization and Windows/UNC identity remain centralized; external-reference viewing remains read-only.

## Risks and Unknowns

The request-boundary mechanism must precede framework header handling and survive supported child-process startup, not merely run inside the bypassable proxy. Preserve Node/Next CLI signal/readiness behavior. File-policy narrowing can reject historical incidental links; prefer explicit authority over opaque receipt/custom data. Nested tool-call schemas and namespace aliases require verification rather than suffix-based tool-name trust.

## Rollback / Recovery

No persistent data migration or manifest rewrite is planned. Reverting the code restores the vulnerable behavior and is not a security mitigation. Deployment remains a separate explicit operation; until fixed code is deployed, existing running instances retain the old behavior. Failed checks and feature resources are retained, not erased for convenience.

## Completion Checklist

- [x] Both bypasses are closed on supported entrypoints with meaningful focused adversarial regressions and documented boundaries; full acceptance remains separate below.
- [x] Independent review findings are resolved and complete acceptance passes for the settled candidate.
- [x] Durable mechanisms/limits live in maintained guides; final evidence and exact source/target IDs are recorded.
- [x] Verified candidate is handed to the Git lifecycle without publication or host deployment.
