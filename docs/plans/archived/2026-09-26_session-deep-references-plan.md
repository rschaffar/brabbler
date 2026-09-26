# Session deep references

## Goal
Copy a navigable Pi Web session URL from each sidebar row and let a pasted URL provide bounded, explicit conversation context to the agent without changing the visible user message.

## Plan
- [x] Add a copy-link row action and translations, using the existing `?session=` deep link and clipboard helper; verified by `components/SessionSidebar.test.mjs` and mobile `npm run test:e2e` clipboard check.
- [x] Parse explicit session URLs by UUID and resolve their saved transcripts through `lib/session-reader.ts`; inject only recent user/assistant text (no tool outputs, system prompts, images, or thinking) through a hidden `before_agent_start` message with explicit limits and truncation markers; verified by `lib/session-reference.test.mjs`.
- [x] Wire the host extension into ordinary and Chat-only Pi Web sessions without loading user extensions in Chat-only mode; verified by `lib/session-reference.test.mjs` and `lib/rpc-manager.test.mjs`.
- [x] Document link semantics and limits in `README.md`; `npm test`, `node_modules/.bin/tsc --noEmit`, and `npm run lint` passed. Full browser E2E passed twice before later local integrations; after rebasing onto those integrations, the suite intermittently fails in unrelated scroll-restoration/Settings checks. The affected session-link flow passes in focused desktop and mobile E2E (`E2E_SESSION_LINK_ONLY=1 PLAYWRIGHT_BROWSERS_PATH=<Nix-packaged Playwright browsers> npm run test:e2e`).

## Non-Goals
No cross-instance session fetching, bulk attachment upload, or implicit transcript lookup for IDs without a session URL. The reference is a local-session lookup; a copied URL is not an access token.

## Risks
Referenced sessions may contain sensitive or adversarial user text. Resolve only an explicitly pasted URL; present the excerpt as quoted, untrusted context. Cap both the count and length. Do not turn saved tool outputs or thinking into prompt text.

## Completion Checklist
- [x] Copying a row's link opens that saved session and does not select the row (browser copy/navigation and deep-link tests).
- [x] A URL in the prompt yields a bounded, correctly labeled excerpt in the agent context while the visible prompt remains unchanged (`lib/session-reference.test.mjs`).
- [x] Affected-flow checks passed (unit suite, typecheck, lint, focused browser E2E); full-suite instability is reported, not treated as a session-link regression.
