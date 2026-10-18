# Cache-stable request-local plugin policy

## Goal

Stop moving current plugin policy behind each new assistant/tool response, restoring an append-only provider request prefix without weakening live policy resolution or authorization. Implement only the cache fix first; compaction visibility and upstream SDK transport recovery are separate follow-ups.

## Plan Relationship

Maintains ADR 0016's request-local, per-request policy contract and the existing Session Git Policy implementation. No settings or policy snapshots enter persisted conversation history. Source changes are isolated in `fix/plugin-policy-cache`, starting from local `rst-main` `0777fddbc59dbd02c17455700df1221a2cedc02d`. Local integration and cleanup retain their own workflow/operation approvals; no deployment or publication is authorized.

## Evidence and approach

A user-authorized 16-call synthetic test against installed Pi SDK 1.3.0 / Codex GPT-6.1 Sol found moving constant policy context had zero cache reuse on all SSE calls, versus 86–94% reuse after warming with anchored context. WebSocket anchoring enabled three delta requests instead of repeated full-history sends. The anchored SSE prefix did not keep growing, so this is not a claim of complete provider cache efficiency. Retained evidence: `/tmp/pi-cache-investigation.qCpu0E/LIVE-RESULTS.md`.

Use the SDK's full-transcript `context_with_system` phase to preserve Pi-owned system/tool anchors. Refresh policy each request and insert it in a deterministic block after the earliest user/compaction/branch summary, leaving canonical messages and tool-call/result order untouched. Histories without such an anchor insert after leading system messages, never inside a tool pair. A policy/configuration change may legitimately invalidate that prefix once. Disabled plugins remove their own injected context; settings errors replace stale content with the existing fail-closed warning.

## Plan

- [x] Add failing deterministic regressions for stable request prefixes, multiple plugins, system/tool anchor preservation, policy refresh, disable/errors, compaction/branch-shaped histories and no input mutation.
- [x] Anchor the real plugin runtime's fresh request-only policy and strengthen real-SDK lifecycle coverage, preserving independent tool-side authorization.
- [x] Review the small implementation independently, document the maintained request-layout contract, and pass focused sandboxed checks.
- [x] Freeze the reviewed source and pass complete sandboxed core, browser/terminal and genuine deployment acceptance; record exact source identity, commands, runtime and artifacts.
- [x] Commit the reviewed change and obtain the user's local completion choice; hand exact integration/cleanup operations to the configured Git lifecycle.

## Focused evidence

- Red on the original runtime: `nix run .#test -- core --jobs 2 --file lib/plugins/runtime.test.mjs` registered six tests, failing the prefix/full-system/sibling cases as expected. Retained `/tmp/pi-web-test-core.s358xJ/run.json`; sandbox command execution 35.835s, separate from preparation.
- An intermediate candidate failed TypeScript narrowing before tests (`/tmp/pi-web-test-core.1gJvwx/run.json`); replaced the indexed-property narrowing with an explicit sibling variable.
- Final reviewed focused command: `nix run .#test -- core --jobs 2 --file lib/plugins/runtime.test.mjs --file plugins/git-workflow/policy.test.mjs --file plugins/git-workflow/runtime.test.mjs --file plugins/session-launch/runtime.test.mjs`. All **39 tests / four files**, exporter contracts, genuine type generation, typecheck and lint passed. Retained `/tmp/pi-web-test-core.5gvwuW/run.json`; sandbox execution **52.931s**, source export/preparation/model work separate. Outer exported source SHA-256 `5fe9a233dc4d979654b132d29f98ee6c254cac70e54b0edce359907c1bdce0cb`.
- Independent review found a malformed imported sibling could suppress fresh guidance and that assertions inside faux callbacks could be swallowed. Added defensive validation and malformed/mixed-enable regressions; SDK tests now capture inside callbacks and assert after completion, including request counts/success and both persisted entry shapes. Follow-up review confirmed all findings resolved with no new findings.

## Complete acceptance and handoff

Application commit **`fa9b45edde7c8ce73c21bc1aa9fd9ba89d43bf02`** passed fresh `nix run .#test -- all --workers 2 --jobs 2` on native x86_64 Linux, pinned Node 24 / SDK 1.3. No source writers ran during export. Exact exported digest: `773b37b1d17e7528dcc6ff78c70e5a389ff4620f7bd99c7c66cda5e6e3931ac5` (`/tmp/pi-web-test-source-do5FFV/selection.json`).

- Core: **309 files / 2,414 tests / 10 suites**, none failed, skipped or cancelled; genuine typegen/typecheck/lint and exporter checks passed. Evidence: `/tmp/pi-web-test-core.5ewQDW/run.json` and `/nix/store/rjl6i9f26z9vkz7v9lw3lwjxci9p3v78-pi-web-core-checks`. Core invocation interval: **332.688s**, including its isolated preparation.
- Browser/terminal: **24/24 groups** passed with exact scenario receipts and settled sandboxes. Evidence: `/tmp/pi-web-test-browser.mFzvNF/run.json`. Browser command interval: **523.794s**, including isolated package/support realization, not pure browser execution.
- Genuine Home Manager deployment: every activation, environment/permissions, durable HTTP write/restart, real PTY and final shutdown proof passed, with settled driver/service and retained verified evidence. Evidence: `/tmp/pwv-M6Ehrm/run.json`; guest acceptance **18.98s**, service command interval **73.138s** including driver realization.
- Complete outer command: **604s** including Nix realization/export and overlapped levels; model work, review and coordination are outside this measurement. Full log: `/tmp/pi-policy-cache-acceptance.log`. This is acceptance evidence, not a performance benchmark.

The source fix and maintained behavior guide are complete. The user selected local integration into `rst-main` by its required non-fast-forward method. Exact-state merge approval, execution and separately gated cleanup are owned by the global Git lifecycle after this application-plan handoff; this record is not approval for those operations. This evidence/archive-only follow-up leaves application/test inputs byte-identical to the tested commit and does not relabel the full suite as a new-tip run.

No additional live provider requests, deployment, SDK transport changes or compaction-visibility changes were performed. The existing service still needs a separately authorized deployment to acquire this fix.

## Completion Checklist

- [x] Unchanged policies preserve serialized provider-input prefixes across tool calls.
- [x] Current settings are read every request; disable, malformed state and callback failure never reuse an old permissive policy.
- [x] System/tool anchors and conversation/tool-pair ordering remain intact; policy never persists in the session.
- [x] Required verification passes, or blockers are retained and reported honestly.
- [x] Compaction UI, SDK transport semantics, host service and remote publication are unchanged.
