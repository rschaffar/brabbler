# Browser and terminal regression tests

```sh
nix develop -c npm run test:e2e
nix develop -c env E2E_DIFF_CONTEXT_ONLY=1 npm run test:e2e
nix develop -c npm run test:terminal
```

Focused browser switches: `E2E_ASK_USER_ONLY=1`, `E2E_ACTIVITY_ONLY=1`,
`E2E_TIMESTAMPS_ONLY=1`, `E2E_MOVE_ONLY=1` (destination picker at desktop/mobile sizes),
`E2E_DIFF_CONTEXT_ONLY=1` (Git Explorer + Files-panel 5,000-line diff fixtures at
desktop/mobile sizes), `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1` (optional bundled plugin
settings, all six approval layouts, multi-file diff/collapse controls, snapshots,
historical receipts/expiry fallback, reconnect, cancellation, disable and Stop at
desktop/mobile sizes). The plugin-only selection
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
controls. Git Explorer checks first-file expansion, lazy per-file patch/cache
behavior, one shared split/unified/raw toolbar and first-parent merge inspection.
The focused diff-context selection exercises on-demand context, keyboard gap and
full-file controls, virtualized split/unified and clean Before/After views,
change navigation/search/side-aware line jump, retained state, wrapping/horizontal
scroll and Wide view Escape/focus. Plugin-only also covers immutable approval
snapshots, exact historical receipt context despite changed working files and an
expired-handle response's patch-only fallback without submitting decisions.
Question fixtures verify the shared bounded card body and fixed
footer as well as keyboard/draft/cancellation/expiry contracts. Question and plugin flows also verify completed read-only receipts, reload/reconnect deduplication, exact historical patches despite changed working files, and unmounted collapsed historical diff bodies.
OAuth/SSE account responses are mocked; no provider credentials are
used. Slash commands exercise ordinary session/UI paths without a live model.
Terminal checks execute a real local shell at desktop/mobile sizes and cover
fonts, reconnect/restart, exit, close-during-creation and workspace isolation.

Failures retain screenshots, traces and server logs in `test-results/e2e/`;
terminal checks print their artifact root. Fixtures' owned lifecycle does not
authorize deleting old test roots, dependencies or feature resources. Console
errors and local 5xx responses fail acceptance; only explicitly corroborated
expected conflicts are tolerated.

The [removal checklist](../docs/plans/2026-09-29_policy-driven-git-tools-plan.md)
retains earlier results and gaps. [Archived full-file diff acceptance](../docs/plans/archived/2026-10-07_git-diff-context-plan.md)
records passing context-focused, plugin/receipt and full browser checks at the
implementation checkpoint. Local integration remains separately approved. A
helper/unit pass is not browser acceptance, and source acceptance does not
integrate, rebuild or activate the installed service.
