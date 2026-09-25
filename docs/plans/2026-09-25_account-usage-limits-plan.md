# Provider account usage limits in the composer

## Goal

Show each account's remaining weekly and 5-hour quota when the provider reports those windows, include Pi default in account management with a way to change its login, and show the selected account's limits beside its name in the composer. The user's OpenAI example refers to the `openai-codex` ChatGPT subscription, not OpenAI API-key billing.

## Plan Relationship

`2026-09-25_multi-provider-accounts-plan.md` owns account storage, selection, and live OAuth verification. This plan owns account-aware usage queries and presentation, plus Pi-default login access in the existing account popover; it does not change credential storage or selection semantics.

## Architecture

The existing provider usage adapter already normalizes Codex 5h and weekly windows. Accept an explicit account ID in its request, validate that it belongs to the provider and is authorized, and construct the usage runtime with the same account-bound credential store as model loading; omitted/null means Pi default. Preserve official-origin checks and generic failure responses. In the browser, key in-memory usage snapshots by provider and account (including Pi default); never show an earlier account's result after a switch. Query only supported providers for the selected account and visible account list, with manual refresh and a short freshness interval. Do not present weekly API-key spend as subscription quota. The Pi-default row uses the existing provider-wide OAuth login and API-key save routes rather than adding another credential.

## Non-Goals

- Treating API-key spend as a ChatGPT subscription weekly limit.
- Polling usage continuously or reading account secrets in the browser.
- Changing existing sessions when a project default changes.

## Rollback / Recovery

Only UI and read-only usage requests are added. The Pi-default login control invokes the existing explicit auth flow and can replace the existing default credential; no migration or new secret storage is introduced. A failed quota request must not change account selection or authentication.

## Plan

- [x] Bind `app/api/provider-usage/query/route.ts` and `lib/provider-usage.ts` to the explicitly requested account, fail closed on invalid/mismatched IDs, and verify with focused account-isolation tests (`lib/provider-usage.test.mjs`).
- [x] Show supported weekly/5h remaining buckets for Pi default and authorized additional accounts in `components/ProviderAccounts.tsx`, without cross-account stale data; formatter tests and mocked browser usage requests passed at 1280px/390px.
- [x] Add Pi default to the account-management rows with a change-login action, reusing provider OAuth and API-key routes; browser tests verify default login has no account ID and secondary login does.
- [x] Document the subscription-versus-API-key distinction and quota refresh behavior in `README.md`; formatter test rejects weekly spend and absent windows.

## Completion Checklist

- [x] Focused usage/account tests pass, including rejected IDs, per-account isolation, and optional windows (`node --test lib/provider-usage.test.mjs lib/provider-usage-limits.test.mjs`).
- [ ] `npm test` (1,350 passed), `node_modules/.bin/tsc --noEmit`, `npm run lint`, and focused `E2E_ACCOUNT_ONLY=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome) npm run test:e2e` (1280px/390px) passed. Full `npm run test:e2e` ran twice with system Chrome but stopped before the account UI at existing history scroll restoration assertion `e2e/run.mjs:499`; Playwright's downloaded Chromium cannot launch on this NixOS host without `libglib-2.0.so.0`. No production build was run.
- [ ] Verify feature diff and exact candidate against current local `rst-main` before requesting separate integration approval; do not push or clean up without authorization.
