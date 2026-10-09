# Browser and terminal regression tests

```sh
nix develop -c npm run test:e2e
nix develop -c env E2E_DIFF_CONTEXT_ONLY=1 npm run test:e2e
nix develop -c env E2E_MODEL_SPEED_ONLY=1 npm run test:e2e
nix develop -c env E2E_RUNNING_FORKS_ONLY=1 npm run test:e2e
nix develop -c npm run test:terminal
```

Focused browser switches: `E2E_TRUST_ONLY=1` (worktree/project grants, revocation and restriction at desktop/mobile sizes), `E2E_RUNNING_FORKS_ONLY=1` (historical-message, root, and quoted-response forks while a real SDK extension prompt waits for input; original question replay and completion at desktop/mobile sizes), `E2E_ASK_USER_ONLY=1`, `E2E_ACTIVITY_ONLY=1`,
`E2E_PROJECT_PRIVACY_ONLY=1` (persistent hidden-project switches, safe loading and
response failures, project-filter/count concealment, browser-local eye reveal
persistence across focus/reload/navigation, and independent browser preferences
at desktop/compact/mobile sizes),
`E2E_TIMESTAMPS_ONLY=1`, `E2E_MODEL_SPEED_ONLY=1` (native ChatGPT subscription speed),
`E2E_MOVE_ONLY=1` (destination picker at desktop/mobile sizes),
`E2E_DIFF_CONTEXT_ONLY=1` (Git Explorer + Files-panel 5,000-line diff fixtures at
desktop/mobile sizes), `E2E_GIT_WORKFLOW_PLUGIN_ONLY=1` (optional bundled plugin
settings, all six approval layouts, multi-file diff/collapse controls, snapshots,
historical receipts/expiry fallback, reconnect, cancellation, disable and Stop at
desktop/mobile sizes; combined cleanup also covers discovered directories and
regular files, nested Python caches beside tracked source, one-time approval/rejection under Allow, and reusable allowlists). The plugin-only selection
uses a fixture command delegating to the real server implementation, no model;
real Pi tool-registration lifecycle is also tested separately in `plugins/`. The managed Workflow browser/containment suites are
removed, not skipped acceptance requirements.

Run at a stable source checkpoint, separately from heavy unit/SDK validation.
The scripts require no `.next/dev/lock` in their checkout and launch only their
own **Turbopack dev server on a free loopback port**. They never contact/restart
the installed service on 30141. Do not use production builds, `next start`,
webpack fallback, competing servers or forced clicks.

The `test:e2e` and `test:terminal` runners share `e2e/harness.mjs`: private
HOME/XDG/agent/TMP (and Windows profile/app-data) storage, local repositories and a
private umask. An explicit tool/browser environment allowlist excludes ambient
credentials, provider profiles, Node options, proxies and shell startup overrides;
no existing sessions or model credentials are used. The Nix shell supplies Chromium
through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Never run `npm ci` over Nix-managed
modules or change host browser configuration for acceptance.

The general suite covers session pagination/branches, rendering/scrolling,
sidebar/navigation, files/editing, archive/restore/delete, ordinary inline
extension questions, browser-native `ask_user`, Activity, provider-account
controls, session-local model speed, and independent Git Explorer. It checks the
absence of Workflow controls. Git Explorer checks first-file expansion, lazy
per-file patch/cache behavior, one shared split/unified/raw toolbar and
first-parent merge inspection. The focused diff-context selection exercises
on-demand context, keyboard gap and full-file controls, virtualized split/unified
and clean Before/After views, change navigation/search/side-aware line jump,
retained state, wrapping/horizontal scroll and Wide view Escape/focus. Plugin-only
also covers immutable approval snapshots, exact historical receipt context
despite changed working files and an expired-handle response's patch-only fallback
without submitting decisions. Question fixtures verify the shared bounded card
body and fixed
footer as well as keyboard/draft/cancellation/expiry contracts. `e2e/question-sets.mjs` extends the ask-user selection with mixed question navigation/review, alternative main answers plus additive details, same-tab reload recovery, explicit skip, exclusive choices, cancellation confirmation, failed-send retry, and atomic read-only receipts at both viewport sizes. Question and plugin flows also verify completed read-only receipts, reload/reconnect deduplication, exact historical patches despite changed working files, and unmounted collapsed historical diff bodies.
OAuth/SSE account responses are mocked; no provider credentials are
used. Slash commands exercise ordinary session/UI paths without a live model.

Running-fork checks run in the full suite and via `E2E_RUNNING_FORKS_ONLY=1`.
Real blocked SDK extension commands verify historical/root/quoted copies, independent
child completion and original question replay/completion without a provider. A
replayed question can precede the source's warm-state GET; wait for visible **Steer**
before checking busy-only action guards. **Stop** is inside collapsed mobile More
controls and is not a cross-layout readiness marker. Observe response-waiter
rejections immediately while retaining the original promise's awaited failure, so
intervening UI errors cannot bypass harness diagnostics and owned teardown.

Project-privacy checks run in the full suite and through their focused switch.
They use real isolated settings-file writes, with registry snapshots mocked to
supply two working projects without model calls. Malformed privacy responses
exercise fail-closed rendering without suppressing genuine browser/5xx errors.

Model-speed checks run in the full suite and via the focused environment switch
(the runner does not select a module from a positional filename). At 1280×800
and 390×844 they check exactly Standard/Fast, the visible quota note, More
controls, real speed writes and canonical disk reads, reload/fresh-context
persistence, sidebar session isolation and unsupported-model preference
restoration. Opening System uses no-model `ensure_session`; a completed fixture
dialog saves startup entries without an assistant turn. Desktop checks also
fork/clone a branch omitting the latest speed entry. Only streaming/compaction
flags and one session's SSE endpoint are mocked; pending mutations are delayed
and continued unchanged. A dormant fresh composer also loses its browser-side
acknowledgement after a real Fast save (with a successful, temporarily unavailable,
or stalled state read), verifying authoritative reconciliation, online recovery
and blocked Send without SSE. Node regressions cover overlapping reads, wrapper
ID changes, deadlines, visibility/polling retries and unmount cancellation.
Synthetic auth, `PI_OFFLINE`, disabled cache warming,
and loopback catalog origins keep these fixtures off real providers. Each
context retains trace, console/pageerror and local-5xx safeguards.

Terminal checks execute a real local shell at desktop/mobile sizes and cover
fonts, reconnect/restart, exit, close-during-creation and workspace isolation.

## Diagnostics, shutdown and retention

Every `test:e2e` / `test:terminal` invocation prints a new private directory under
`test-results/e2e/browser-*` or `test-results/e2e/terminal-*`. A later run never
reuses it. CI's existing recursive artifact upload includes these directories.

- `run.json` records the checkout, start/end, status, errors and exact separate
  fixture-storage root. An unfinished `running` record is not acceptance.
- `server.log` contains stdout/stderr and is flushed before final reporting.
  `events.jsonl` timestamps spawn/error/exit/close, requested signals, browser
  console/page errors, failed requests and local 5xx responses. Requested shutdown
  and observed process exit are different events; teardown after an HTTP error
  must not be mistaken for its cause.
- Every context created by these runners (including plugin-only, timestamps,
  account and Activity/privacy peers) starts tracing before pages. `context-N.zip`
  is saved on close on success as well as failure; failure screenshots use the
  same context ID. Context-open events include viewport information. Capture/flush
  failures are reported, never silently replaced with an older trace.
- SIGINT/SIGTERM fail the run and start owned-server shutdown immediately. Normal
  and interrupted teardown requests SIGTERM, escalating after 10 seconds, then
  waits up to 5 more seconds. Graceful SIGTERM targets the child so Next can close
  its own workers and release its lock; POSIX escalation targets the newly spawned
  process group while its leader is still owned, and Windows targets the child.
  Browser launches have a 30-second deadline and late arrivals are closed after
  interruption. Browser diagnostic operations are individually
  bounded: screenshots/close operations get 5 seconds; potentially >100 MB trace
  archives get a separately measured 30-second export budget. Application assertion
  deadlines are unchanged. The runner observes child/pipe closure and POSIX process
  group absence. A surviving/unknown group fails without signaling a recycled group
  ID; escaped descendants and Windows descendants are **not certified**. Unsettled
  shutdown is a failure, not a cleanup certificate.
- Artifacts **and fixture roots are retained** on both success and failure. The
  paths in the manifest, not an age/wildcard scan, identify candidates for separately
  authorized cleanup. Nothing here authorizes deleting old roots, dependencies,
  backups or feature resources. Auxiliary standalone PDF/theme scripts are not
  part of these two runner lifecycle guarantees.

Console/page errors and local 5xx responses fail acceptance; only explicitly
corroborated expected conflicts are tolerated. Aborted requests are diagnostic
information, not blanket failures: SSE/navigation legitimately cancels requests.
Before a justified retry, inspect the exact run's logs, response/trace evidence
and child lifecycle. Keep the original failure visible. An unchanged passing
retry is not a root-cause diagnosis or a fix; do not add blanket retries, hide
errors or inflate deadlines to force a pass.

Harness regressions: `lib/e2e-harness.test.mjs` runs in the common core suite.
Focused helper tests do not replace real browser/terminal acceptance.

The [removal checklist](../docs/plans/2026-09-29_policy-driven-git-tools-plan.md)
retains earlier results and gaps. [Archived full-file diff acceptance](../docs/plans/archived/2026-10-07_git-diff-context-plan.md)
records passing context-focused, plugin/receipt and full browser checks at the
implementation checkpoint. Local integration remains separately approved. A
helper/unit pass is not browser acceptance, and source acceptance does not
integrate, rebuild or activate the installed service.
