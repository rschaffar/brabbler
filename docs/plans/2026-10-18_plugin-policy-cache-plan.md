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
- [ ] Freeze the reviewed source and pass complete sandboxed core, browser/terminal and genuine deployment acceptance; record exact source identity, commands, runtime and artifacts.
- [ ] Commit the reviewed change and resolve local completion/integration through the configured Git lifecycle.

## Focused evidence

- Red on the original runtime: `nix run .#test -- core --jobs 2 --file lib/plugins/runtime.test.mjs` registered six tests, failing the prefix/full-system/sibling cases as expected. Retained `/tmp/pi-web-test-core.s358xJ/run.json`; sandbox command execution 35.835s, separate from preparation.
- An intermediate candidate failed TypeScript narrowing before tests (`/tmp/pi-web-test-core.1gJvwx/run.json`); replaced the indexed-property narrowing with an explicit sibling variable.
- Final reviewed focused command: `nix run .#test -- core --jobs 2 --file lib/plugins/runtime.test.mjs --file plugins/git-workflow/policy.test.mjs --file plugins/git-workflow/runtime.test.mjs --file plugins/session-launch/runtime.test.mjs`. All **39 tests / four files**, exporter contracts, genuine type generation, typecheck and lint passed. Retained `/tmp/pi-web-test-core.5gvwuW/run.json`; sandbox execution **52.931s**, source export/preparation/model work separate. Outer exported source SHA-256 `5fe9a233dc4d979654b132d29f98ee6c254cac70e54b0edce359907c1bdce0cb`.
- Independent review found a malformed imported sibling could suppress fresh guidance and that assertions inside faux callbacks could be swallowed. Added defensive validation and malformed/mixed-enable regressions; SDK tests now capture inside callbacks and assert after completion, including request counts/success and both persisted entry shapes. Follow-up review confirmed all findings resolved with no new findings.

## Completion Checklist

- [x] Unchanged policies preserve serialized provider-input prefixes across tool calls.
- [x] Current settings are read every request; disable, malformed state and callback failure never reuse an old permissive policy.
- [x] System/tool anchors and conversation/tool-pair ordering remain intact; policy never persists in the session.
- [ ] Required verification passes, or blockers are retained and reported honestly.
- [x] Compaction UI, SDK transport semantics, host service and remote publication are unchanged.
