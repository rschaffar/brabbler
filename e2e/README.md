# CI and browser regression tests

Adapted from @Nuctori's CI/E2E proposal in #617 and #599. The performance
scanner, reverse reader, sidebar changes, and timing benchmarks are not included.

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

For a focused browser-native `ask_user` run, set `E2E_ASK_USER_ONLY=1`.
For the Activity overview, set `E2E_ACTIVITY_ONLY=1`.
For the desktop Git workflow fixture (local repository, no model), set `E2E_GIT_WORKFLOW_ONLY=1`.
If the Playwright-managed Chromium is unavailable, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a compatible local Chrome/Chromium
binary; the default CI path remains the Playwright-managed browser.

The script starts and stops its own Turbopack dev server on an available
loopback port. Run it in a checkout without an active dev server; Next.js
shares `.next/dev/lock` within a checkout. All fixtures are created before
startup in a temporary `PI_CODING_AGENT_DIR` and removed on completion.
No model credentials or existing Pi sessions are needed.

CI runs lint, type checking, and unit tests in one job. A separate job builds
the application in a clean checkout and runs the same browser tests with
`E2E_SERVER_MODE=start` against `next start`. Do not build in a checkout used
for development.

Coverage:

- A 5,000-message session opens with exactly the last 50 entries, bounded
  detail/context responses, and no browser errors.
- Desktop and mobile scrolling load two consecutive older pages. Each response
  has the expected IDs, no gaps or duplicates, and the messages appear once in
  the chat. A small session checks pagination through the root.
- Branch context follows the selected leaf and excludes the other branch.
- Markdown, code blocks, and real tool-call/tool-result blocks render.
- Chat width and font size persist, existing drafts resize, and short settings
  panels keep every language option reachable on desktop and mobile.
- Unknown sessions and paths outside the fixture project are rejected.
- A local extension checks inline question cards in the chat scroller, keyboard navigation,
  Esc cancellation, collapse/expand draft preservation, countdown display, and server-side expiry.
- The native inline `ask_user` card checks single/multi selection, freeform answers,
  comments, collapse preservation, cancellation, and expiry at desktop and mobile widths.
- The focused Activity run checks background questions, short-run completion/review,
  first-browser baselines, cross-tab acknowledgement and reload, cross-project
  filtering, and navigation at 1280px, 700px, and 390px without model credentials.
- The focused Git workflow run checks project/session preferences without a browser reload,
  whole-merge/single-commit/consecutive-range review, explicit manual commit preview/confirmation,
  saved-check verification, exact proposal acknowledgement and separately confirmed local non-FF merge,
  and same-chat continuation into an existing registered worktree. The agent-triggered post-run
  transition is covered by focused unit tests, not a model-driven browser run.
- The account controls test checks compact model-adjacent placement, popup-blocked OAuth
  links, device link/code/copy, progress persistence, invalid URL rejection, and
  cancellation at 1280px and 390px using mocked SSE (no provider credentials).

Model prompts, live model streaming, and agent execution are outside this suite.
Failures save a screenshot, Playwright trace, and server log under
`test-results/e2e/`; CI uploads that directory. Open a trace with
`npx playwright show-trace test-results/e2e/trace.zip`.
