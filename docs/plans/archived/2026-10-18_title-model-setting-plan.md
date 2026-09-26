# Title model setting

## Goal
Let the operator choose a server-stored, inexpensive model for Generate title without changing the conversation model.

## Architecture
The existing `~/.pi/agent/pi-web/title-settings.json` holds both language and an optional provider/model ID. General Settings displays an available-model picker with a session-model default. A title request resolves the saved model against the session-bound runtime and uses the session's credentials, failing explicitly if it is no longer available instead of silently charging the conversation model.

## Plan
- [x] Extend title settings persistence without losing the other preference; verified by `app/api/sessions/title-model/route.test.mjs` (round-trip and corrupt-file tests).
- [x] Add a guarded title-model API and picker in General Settings; verified by route, component and browser E2E tests.
- [x] Resolve the selected model for the standalone title request; verified by `lib/session-title.test.mjs` (model, provider key, missing-model error, unchanged chat model).
- [x] Document behavior in `AGENTS.md`; `npm test` (1,382 passed), `node_modules/.bin/tsc --noEmit`, `npm run lint` and `npm run test:e2e` (local Chrome) passed. Initial E2E failures were caused by an external node_modules symlink and absent Playwright Chromium libraries; a subsequent 403 exposed a missing-cwd picker fetch and was fixed.

## Rollback / Recovery
The setting is optional. Selecting “Use session model” clears it; reverting the feature leaves the language field readable by previous versions. A missing or unauthenticated saved model reports an error rather than falling back to a costly model.

## Completion Checklist
- [x] Existing sessions still use their own model by default; changing title model never changes their chat model (session-title tests).
- [x] All required checks pass on the final candidate (see verification in the feature handoff).
- [x] Update maintained documentation in `AGENTS.md` and archive this plan.
