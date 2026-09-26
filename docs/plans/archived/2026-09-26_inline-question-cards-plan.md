# Inline question cards

## Goal

Show all blocking extension questions (`ask_user`, select, confirm, input, editor) as answerable cards in the chat timeline rather than floating over the conversation.

## Plan Relationship

`2026-09-25_browser-ask-user-plan.md` owns the native tool contract and its outstanding full browser-suite check. This plan changes only question presentation; it does not change transport or server settlement.

## Plan

- [x] Render both question components at the live end of `components/ChatWindow.tsx` inside the message scroller, preserving response handling and draft/collapse controls; `components/ChatWindow.extension-request.test.mjs` passes.
- [x] Keep questions visible, accessible and usable on narrow screens, including keyboard focus, scrolling, countdown, cancel and expiry; full browser suite passes at 1280px and 390px with local Chrome.
- [x] Run `npm test` (1378 passing), `node_modules/.bin/tsc --noEmit`, `npm run lint` (clean after hook fix), and `npm run test:e2e` (full suite passing with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v google-chrome)`).
- [x] Document current inline presentation in `AGENTS.md` and update browser test expectations.

## Non-Goals

Persisting answered question cards in session history, changing the extension UI protocol, or moving non-question custom UI panels and notices.

## Completion Checklist

- [x] All five question types appear in the chat timeline without covering messages or the composer (browser and component tests).
- [x] Answer, cancel and timeout retain the existing request lifecycle (browser tests); reconnect still uses the unchanged pending-request replay path.
- [x] Verification results recorded above; feature branch is ready for exact-state local integration approval after its commit.
