# Browser and terminal regression tests

```sh
nix develop -c npm run test:e2e
nix develop -c npm run test:terminal
```

Focused browser switches: `E2E_ASK_USER_ONLY=1`, `E2E_ACTIVITY_ONLY=1`,
`E2E_TIMESTAMPS_ONLY=1`, `E2E_MOVE_ONLY=1` (destination picker at desktop/mobile sizes),
`E2E_GIT_WORKFLOW_PLUGIN_ONLY=1` (optional bundled plugin settings, approval,
reconnect, disable and Stop at desktop/mobile sizes). The plugin-only selection
uses a fixture command delegating to the real server implementation, no model;
real Pi tool-registration lifecycle is also tested separately in `plugins/`. The managed Workflow browser/containment suites are
removed, not skipped acceptance requirements.

Run at a stable source checkpoint, separately from heavy unit/SDK validation.
The scripts require no `.next/dev/lock` in their checkout and launch only their
own **Turbopack dev server on a free loopback port**. They never contact/restart
the installed service on 30141. Do not use production builds, `next start`,
webpack fallback, competing servers or forced clicks.

Fixtures use disposable HOME/XDG/agent storage, local repositories and a private
umask; no existing sessions or model credentials. The Nix shell supplies Chromium
through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Never run `npm ci` over Nix-managed
modules or change host browser configuration for acceptance.

The general suite covers session pagination/branches, rendering/scrolling,
sidebar/navigation, files/editing, archive/restore/delete, ordinary inline
extension questions, browser-native `ask_user`, Activity, provider-account
controls, and independent Git Explorer. It checks the absence of Workflow
controls. OAuth/SSE account responses are mocked; no provider credentials are
used. Slash commands exercise ordinary session/UI paths without a live model.
Terminal checks execute a real local shell at desktop/mobile sizes and cover
fonts, reconnect/restart, exit, close-during-creation and workspace isolation.

Failures retain screenshots, traces and server logs in `test-results/e2e/`;
terminal checks print their artifact root. Fixtures' owned lifecycle does not
authorize deleting old test roots, dependencies or feature resources. Console
errors and local 5xx responses fail acceptance; only explicitly corroborated
expected conflicts are tolerated.

The [current removal checklist](../docs/plans/2026-09-29_policy-driven-git-tools-plan.md)
records results and gaps. A helper/unit pass is not browser acceptance, and source
acceptance does not integrate, rebuild or activate the installed service.
