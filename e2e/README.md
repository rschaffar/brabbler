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
On Linux with Nix, run `nix develop` from a committed checkout and then
`npm run test:e2e` inside that shell (or `nix develop -c npm run test:e2e`).
The locked shell builds modules from the lockfile and copies them locally once:
Turbopack cannot resolve store-linked packages outside the workspace root.
Do not run `npm ci` in the Nix-managed tree. The shell also supplies Node.js,
Git and Nix-wrapped Chromium, and sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
without changing the host's browser configuration. It avoids Playwright's
binary missing shared libraries on NixOS. Update the nixpkgs Chromium pin
alongside Playwright version changes; even matching major versions need browser
regression tests. If the Playwright-managed Chromium is unavailable outside the
Nix shell, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a compatible local
Chrome/Chromium binary. Ubuntu CI keeps the Playwright-managed browser.

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
- The focused Git workflow run checks an in-chat agent settings proposal card with a mocked read/apply endpoint (the real locked save/identity path is tested by API tests), project/session preferences without a browser reload,
  whole-merge/single-commit/consecutive-range review, default whole-file manual commit and explicit staged
  partial-hunk preview/confirmation (exact tree/commit, surviving unstaged hunk and unrelated staged entry),
  one explicit ordered batch of two required saved checks, exact proposal review, and separately confirmed local FF and non-FF integration
  **when the Linux user-service check containment backend is available**. The FF assertion proves the target becomes the
  existing feature object with its original parents and tree, then restores only the clean disposable fixture before
  the non-FF test obtains a distinct approval. A preceding separately approved stale-target attempt must fail once,
  preserving the concurrent target without automatic checks, planning, rebaselining or retry; the fixture then
  explicitly restores its clean target and the browser obtains fresh checks and a new approval. On unsupported hosts it
  checks that verification fails closed; process containment is not a sandbox. The run also checks
  same-chat continuation into an existing registered worktree. The agent-triggered post-run
  transition is covered by focused unit tests, not a model-driven browser run.
- The Git workflow fixture also checks the static **Check outcome information** note: no approval/release/rerun/cleanup
  controls or recovery requests on refresh, a real diagnostic-only compatibility GET, and a real retired POST returning
  410. History does not authorize or block another invocation, and the note makes no stopped-process or safe-files claim.
  No passing receipt, native proof or recovered response is mocked. Optional diagnostics warnings do not revoke known
  check/native success. Legacy paired integration deliberately refuses extended recipes (including explicit stage `none`);
  these fixtures keep omitted-field recipes and never waive a required sibling.
- The account controls test checks compact model-adjacent placement, popup-blocked OAuth
  links, device link/code/copy, progress persistence, invalid URL rejection, and
  cancellation at 1280px and 390px using mocked SSE (no provider credentials).

Batch correlation in browser receipt DTOs is informational metadata read from actual process-private cohort membership,
not a public cohort/owner/proof capability. Component and route regressions cover two-check batches, missing or mixed
siblings, failed-own-attempt no-fallback, and independent older native evidence remaining valid. After a failed explicit
batch the same mounted panel must not silently select an earlier passed batch, even on review refresh; a new check batch
requires a fresh explicit action. Browser clock restoration must use advancing system time, not a fixed timestamp that
makes later genuine server receipts appear to come from the future.

During the current optimistic-invocation source migration, these updated browser scripts are **not yet browser-verified**.
Do not launch them while other owners are changing native adapters. Once the coordinator declares the tree settled, use
`E2E_GIT_WORKFLOW_ONLY=1 npm run test:e2e` in the isolated Nix development environment described above. No production build,
live configuration, existing private history, remote operation or application Git lifecycle action is part of this run.

Model prompts, live model streaming, and agent execution are outside this browser suite. An **opt-in**, provider-backed Git-guidance regression uses an in-memory SDK chat and disposable Git checkout, with an inert `git_workflow status` probe; it does not edit a live chat or repository. It checks that a real model renders ordinary LaTeX without tools, then requests one read-only Git status for an explicitly Git-related question. Select `PI_PROVIDER` and `PI_MODEL` for an available account and run `PI_GUIDANCE_MODEL_EVAL=1 node e2e/git-guidance-model.mjs` only with authorization for the provider usage charge. The SDK accesses configured authentication; the test does not inspect/copy credential values, record generated text, grant mutations, or run automatically in CI. Real-model behavior can vary with provider and time; this smoke check is not a guarantee about every user prompt.

Failures save a screenshot, Playwright trace, and server log under
`test-results/e2e/`; CI uploads that directory. Open a trace with
`npx playwright show-trace test-results/e2e/trace.zip`.
