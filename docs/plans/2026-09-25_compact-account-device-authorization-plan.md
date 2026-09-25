# Compact account controls and usable device authorization

## Goal

Keep the chat composer compact on mobile by showing the selected model-provider account as a small control next to the model selector. Make OAuth device authorization actionable: a safe clickable verification link, a copyable code, and a way to cancel without losing account-selection behavior.

## Plan Relationship

`docs/plans/2026-09-25_multi-provider-accounts-plan.md` owns provider credential storage, session/project bindings, and the remaining live-provider OAuth integration gap. This plan owns only presentation and browser interaction for those existing flows; it does not change the credential store, server OAuth protocol, or claim a live external-provider test.

## Architecture

`ChatWindow` will pass the existing `ProviderAccounts` component into `ChatInput`'s bottom control bar. The component will show a short current-account label beside the model, while keeping provider choice, session account, project default, and management actions in a responsive popover. The label always describes the displayed model's provider, not a different provider chosen within the popover. In-flight authorization retains its state while the popover is closed, and unmount/cancel closes its SSE connection.

Both the Pi-default `ModelsConfig` flow and additional-account `ProviderAccounts` flow consume the same server SSE events. Validate authorization/device URLs before opening or linking (HTTPS, or loopback HTTP for local callbacks), show device code and link as structured elements rather than status prose, reuse clipboard behavior for a Copy button, and preserve the code through progress events until success/cancellation. Pin manual-response tokens to the provider that opened the stream; recalculate mobile popover position after the keyboard-driven composer move. No credential or token is put in a URL or copied to the clipboard.

## Risks and recovery

The account UI controls credential selection, so hiding a binding or silently substituting Pi default is unacceptable. Keep the unavailable-account option, busy-state guard, provider-independent management, and session/project distinction. A popover must fit a 390px viewport with the keyboard up, keep the selected chat usable, and have keyboard dismissal. The code changes are presentation-only; backing out this feature does not rewrite sessions or stored credentials.

## Plan

- [x] Move `ProviderAccounts` into the `ChatInput` model toolbar as a compact account indicator with an accessible, responsive popover; the full Chrome E2E run covered the existing session/default/unavailable selection cases plus placement and visible menu at 1280px and 390px.
- [x] Render validated clickable OAuth and device URLs, structured device codes, Copy/Copied feedback, and explicit cancel/cleanup in `ProviderAccounts` and `ModelsConfig`; `node --experimental-strip-types --test lib/oauth-url.test.mjs lib/clipboard.test.mjs` passed (2 tests), and mocked-SSE Chrome E2E covered both views, malicious URL rejection, popup-blocked links, progress and cancellation. A later review identified provider-switch, remote plaintext URL, and keyboard-resize cases; provider pinning/selector locking, HTTPS-or-loopback checks, and post-layout repositioning now pass focused unit tests, typecheck, lint, and full Chrome E2E with a 390px viewport shrink.
- [ ] Update README/AGENTS current behavior and run focused tests, `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e` in the feature worktree. Do not run a production build.

## Completion Checklist

- [x] The selected account is visible beside the model without permanent composer rows; session account, project default, and management were exercised at 390px mobile and desktop in Chrome E2E.
- [x] Device authorization has a safe clickable URL, copyable code, visible progress/cancel, and no stale EventSource after teardown; provider locking, URL restrictions, keyboard-resize placement, and both mocked SSE browser views passed the full Chrome E2E and focused URL/clipboard tests. Live external-provider authorization remains owned by the adjacent multi-provider plan.
- [ ] Verification passes on the exact feature tip, documentation is current, and completed plan is archived before a reviewable commit and separately approved local integration.
