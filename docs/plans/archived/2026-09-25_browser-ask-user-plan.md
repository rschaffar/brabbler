# Browser-native ask_user

## Closure — completed (2026-10-27)

Integrated lineage `43abbe9` is on audited main. Later complete Nix acceptance
includes the actual question/answer, reconnect/reload, expiry and mobile-cancel
flow; the old history-scroll/library blockers below are no longer the verification
boundary. Current contracts belong to `docs/questions.md`. See the
[closure evidence](../README.md#closure-evidence). Original checkboxes and failures
below are historical, not active work or a claimed fix of the old unchanged retry.

## Goal

Pi Web owns an MIT-attributed, web-focused `ask_user` implementation that keeps the installed tool's parameters, results and event semantics while presenting real browser controls instead of an ANSI terminal panel. The separate Pi TUI installation remains untouched.

## Architecture

An inline extension registers `ask_user` for ordinary web sessions and extension-enabled subagents. The per-session extension UI context exposes a private structured request method; the existing pending-request/SSE/response lifecycle handles reconnect, timeout, Stop and teardown. React renders the request as a responsive, accessible form. Only a recognized external `pi-ask-user` package is suppressed in web sessions, not unrelated extensions or terminal Pi.

## Plan

- [x] Port the web-relevant schema, normalization, answer handling and privacy-preserving events from upstream v0.15.0 into `lib/ask-user*`, include the MIT license/attribution; `lib/ask-user.test.mjs` passes malformed input, cancellation and answer validation.
- [x] Register the local inline extension and suppress the recognized upstream package in `lib/rpc-manager.ts` and extension-enabled `lib/subagent-runtime.ts`; unit collision test and focused browser fixture with a competing extension confirm a single active local tool.
- [x] Extend the existing session-scoped extension UI request/response flow to transport structured questions and answers with server-side validation; `lib/rpc-manager-extension-ui.test.mjs` passes replay, invalid response, Stop and expiry checks.
- [x] Add browser-native single/multi/freeform/comment/context form in `components/` and hook it into `ChatWindow`/`useAgentSession`; focused browser tests pass at 1280px and 390px, including cancel and timeout.
- [x] Document scope in `README.md`, `AGENTS.md` and `e2e/README.md`; `npm test` (1313 passing), `node_modules/.bin/tsc --noEmit`, `npm run lint`, and focused `E2E_ASK_USER_ONLY=1 ... npm run test:e2e` pass.
- [ ] Get a clean full `npm run test:e2e` result in a compatible environment or explicitly accept the existing unrelated failure: two runs with system Chrome stopped at `Returning to older history must restore its reading offset` before the ask_user flow. Installing Playwright's matching Chromium did not help on NixOS: the downloaded headless shell cannot load `libglib-2.0.so.0`. The focused browser run with system Chrome passes.

## Non-Goals

No replacement of Pi's standalone TUI extension, no generic rich-form protocol for third-party tools, and no remote publication.

## Rollback / Recovery

The change does not migrate stored data. Revert the local extension and new UI request case to return to the installed extension's existing custom panel; pending requests are transient and close on wrapper shutdown.

## Completion Checklist

- [x] Web sessions show the local tool exactly once with browser controls, including with a competing recognized package; external terminal Pi is untouched.
- [x] Result shape and cancellation semantics match the installed extension for supported inputs (unit tests and browser fixture).
- [ ] Full browser suite passes or its unrelated history-scroll failure receives explicit disposition.
