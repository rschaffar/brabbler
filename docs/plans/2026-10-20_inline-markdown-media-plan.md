# Explicit local Markdown media embeds

## Goal

Adapt upstream `51b11598d6237d4e0649549cea67ae74b5a4a6a9` into local-file audio/video embeds in settled user/assistant chat. The user authorized implementation and chose local files only and chat only. Ordinary links keep opening Files; remote media becomes a safe link. No request occurs before explicit Load player activation.

## Context and Plan Relationship

Base `rst-main`: `1fe0a04c2d6d11e0c301457e379289d3a61f1508`. Branch `feat/inline-markdown-media`, worktree `/home/robert/projects/3rdparty/pi-web-worktrees/inline-markdown-media`. Parent is sole writer/test coordinator. Existing archived 2026-10-20 security/follow-up plans and ADR 0026 own file-reference authority and probe boundaries; no active plan owns media embeds.

Preserve SDK 1.3.0, Node 24.21.0, Next 16.4.2, manifests/locks and Nix pins. No remote Git, live providers, credentials/session data, installed service or host deployment. Integration requires the separate completion decision and exact-state approval under the mandatory isolated non-FF rst-main workflow.

## Plan

- [x] Add pure local media classification, generated session-bound file URLs, and adversarial path/URL regressions; retain the single server authorization boundary.
- [x] Add click-gated native players, labelled errors/recovery, stable identity and resource disposal. Pause/release on covered/hidden chat, source/session changes and unmount; do not automatically resume.
- [x] Opt in settled user/assistant Markdown only. Preserve ordinary images/links, blocked-relative feedback, nested-link semantics, source positions and independent preview/skill/question renderers.
- [x] Add core lifecycle and real desktop/mobile browser coverage: no eager requests, playback/seeking, authorized external files/wrong-session denial, errors, disposal and layout.
- [x] Update maintained feature/browser guides; obtain independent read-only security/lifecycle review and resolve findings.
- [ ] Run focused sandboxed Nix checks, then complete fresh `nix run .#test -- all --workers 4 --jobs 4` after source settlement if admitted; record exact candidate/input, results, runtime/preparation/execution and artifacts.
- [ ] Commit coherent reviewed work, reassess current rst-main and hand off the clean verified candidate for completion/integration choice. Remote publication and deployment remain unauthorized.

## Iteration Evidence

- Initial focused Nix core/static pass: 5 files / 64 tests, 75 seconds end-to-end, `/tmp/pi-web-inline-media-core.Qcg0yS.log`, `/tmp/pi-web-test-core.m9rkne/run.json` (outer digest `ce5908ea5f079de96002f453eec965e3fa5af50ea10afeebc8115de98e05ed48`).
- First browser call exceeded its outer tool-call 240-second limit during cold application preparation/execution. Its retained capsule subsequently settled a genuine corrupt-file-repair failure: `/tmp/pi-web-inline-media-markdown.GfFR2f.log`, `/tmp/pi-web-test-browser.K8BZa8/run.json` (outer driver remains incomplete), immutable `/nix/store/1sll4y69lqhb124vs2la2bvc1awxc2kn-pi-web-browser-markdown-diagnostics/result.json`. Inner execution was 94.447 seconds, failed, settled with closed port. Trace shows one HTTP 206 corrupt-file request and no new request on explicit reload after repair: Chromium reused failed media. Explicit activation now adds a fresh URL token; no automatic retry, browser error exemption or test deadline change. The incomplete outer run/resources are retained, not cleaned or relabeled as acceptance. Later long commands use an owned background coordinator instead of an outer tool-call deadline.
- Token-corrected focused Nix core passed 6 files / 71 tests in 71 seconds; real desktop/mobile Markdown passed in 355 seconds end-to-end including application preparation, with 164.383 seconds capsule execution. `/tmp/pi-web-inline-media-focused.uCYAL7/{core,markdown}.log`, `/tmp/pi-web-test-core.kY5qb1/run.json`, `/tmp/pi-web-test-browser.X3Sjn6/run.json`. This proves real native WAV/VP8 playback/seek, external-reference ranges/denials, corrupt-file repair and disposal, but predates final review refinements.
- Independent security review found encoded/whitespace media URLs could fall through to image loading. Classification now normalizes URL pathnames and decodes only for recognition, preserving navigation and authorization identity; regression cases cover encoded API/remote and whitespace sources. The opted-in sanitizer admits file-URI sources only for recognized local media, leaving nonmedia file images stripped.
- Independent lifecycle review found Settings/trust modal coverage missing and a 600/640 breakpoint discrepancy in the fixture. Modal flags now deactivate players, real desktop Settings disposal/no-resume is asserted, and the fixture uses 640. Both reviewers re-read corrections and found no remaining scoped blocker. They ran no competing checks.
- Post-review focused Nix core/static pass: 6 files / 72 tests, `/tmp/pi-web-inline-media-review-checks.zEWFVv/core.log`, `/tmp/pi-web-test-core.kHLeqA/run.json`, outer digest `71513daf5dc8e1ac095948debf3cd5c13ce7d796eb85c3556a74c1b95aad7cc2`. Core command wall time was 57 seconds. Post-review desktop/mobile Markdown passed in 267 seconds command wall time including in-run realization/preparation, with 155.243 seconds capsule execution: `/tmp/pi-web-inline-media-review-checks.zEWFVv/markdown.log`, `/tmp/pi-web-test-browser.xgKBU3/run.json`, outer digest `810ebccbcc9222c23bd12f1186d3bc3bc1a089e1a314bd3ea153608015e1a952`. Includes encoded API/remote and whitespace URL cases, native hover identity and Settings modal disposal/no-resume. Full acceptance remains pending below. Existing unrelated ref-cleanup lint warnings remain warnings.

## Architecture and Risks

Recognition is not authorization. Reuse file-links/file-paths/file-types and `/api/files` with originating sessionId; never register roots or broaden transcript extraction. No media watchers, edit/Git probes, eager fetches, remote proxy, transcoding, or raw audio/video HTML enablement. File-URI/drive source handling must remain narrowly sanitized and cannot leak raw file URLs. Remote embeds must not fall through to broken image loads. Linked embeds remain noninteractive labels inside their enclosing links.

Existing generic reference-read symlink/replacement races and streaming backpressure limitations are not solved or widened. Codec support is browser-dependent. Native controls do not provide captions/transcripts automatically. No durable format migration; revert feature commits if needed, without changing file authorization or pins.

## Completion Checklist

- [ ] Approved local/chat-only behavior implemented and independently reviewed.
- [ ] Focused and complete Nix acceptance evidence recorded honestly; failures retained, no console/5xx suppression or deadline inflation.
- [ ] Durable behavior documented and feature resources/IDs handed off without claiming unapproved integration or deployment.
