# Packaged-service browser and terminal acceptance

All acceptance runs against the **actual Nix-built application**, started through
its installed launcher and real Home Manager systemd user unit in one NixOS VM.
There is no development-server, in-place, host-service or non-Nix fallback.

```sh
# Complete core + packaged-service acceptance (may reuse cached check outputs):
nix flake check -L
# Fresh full VM execution:
nix run .#test -- e2e
# Fresh focused iteration, not full acceptance:
nix run .#test -- e2e --group markdown
nix run .#test -- e2e --group terminal
nix run .#test -- e2e --group git-plugin
```

Nix realizes pinned dependencies/package/driver automatically. No `npm ci`,
Playwright download or checkout-local `node_modules` is required. The native Linux
host must expose KVM to the invoking user/Nix builder. See [testing](../docs/testing.md)
for source snapshots, optional offline operation, resource budgets and cached versus
fresh evidence. Production builds occur only in isolated Nix builders, never in a
working checkout's `.next`.

## Complete group inventory

`nix/e2e-groups.json` is the single selection inventory used by the CLI and VM
script. Full acceptance executes every group, not merely the browser suite's
historical unselected branch. A core regression checks that every browser
`E2E_*_ONLY` selector appears exactly once. Selectors remain fixture internals;
users choose named groups, never combine environment switches.

| Group | Coverage |
| --- | --- |
| `general` | Session pagination/branches, rendering/scrolling, sidebar, files, archive actions, inline/browser questions, accounts, Activity/privacy basics, Git Explorer and shared flows |
| `worktrees` | Management inventory, paging, trust boundaries, stale/lost preparation recovery and bounded cleanup receipts |
| `session-launch` | Real SDK tool, exact approvals/settings, independent faux-provider child sessions and receipt navigation |
| `running-forks` | Historical/root/quoted forks while the original real SDK extension waits for input |
| `model-speed` | Native model speed writes, canonical packaged disk reader, persistence and ambiguous acknowledgement reconciliation |
| `trust` | Worktree/project grants, revocation and restriction |
| `git-plugin` | Bundled Git Workflow, approvals, immutable reviews, receipts, expiry/reconnect and cleanup |
| `appearance` | Default/full/reading widths, wide-screen legacy preferences, typography and reload |
| `timestamps` | Message timestamp presentation |
| `diff-context` | Explorer/Files immutable 5,000-line diff contexts, navigation, wrapping and Wide view |
| `markdown` | Markdown/KaTeX security, Mermaid math/themes/SVG, preview state, file links and live user-file changes |
| `file-edit` | File editor/read-only/diff behavior |
| `archive` | Focused archive/restore flow |
| `privacy` | Project concealment/loading/failure behavior, independent contexts and tablet coverage |
| `activity` | Full Activity overview, real worktree/subagent fixtures and tablet coverage |
| `accounts` | Provider account selection and native OAuth metadata with synthetic browser responses |
| `questions` | Browser-native mixed question sets, draft/reload/cancel/receipts and tool-registration assertions |
| `session-links` | Desktop/mobile link copying and following the copied link |
| `bulk` | Bulk archive/conflict/retry/restore/delete |
| `move` | Full destination picker, plain/Git/worktree/Browse paths, superseded reads and proposal-only changes |
| `terminal` | Real shell/PTY, fonts, reconnect/restart/exit, creation cancellation and workspace/Explorer coexistence |

Existing viewport-specific assertions are retained, including desktop/mobile,
focused wide-screen cases and 700px Activity/privacy coverage. All groups use the
same immutable package; one guest boot serves the entire run. Service stop, fresh
fixture roots and fresh browser contexts isolate groups. A selected group is not
full acceptance, even if its assertions overlap the general suite.

## Guest lifecycle and boundaries

1. Boot one restricted-network NixOS guest and activate the **real pinned Home
   Manager NixOS integration** for an ordinary user.
2. Start that user's manager after initial activation. Its generated
   `default.target.wants` starts the real application unit. Verify readiness and
   stop it before the scenario groups.
3. For each group, create new private synthetic fixture/evidence directories.
   Seed sessions, repositories and extensions before starting the application.
   Service and runner share identical physical paths/UID and a private fixture
   environment supplied through the unit's runtime environment file.
4. Start only that fixed user unit. Bind its `InvocationID`, main PID, restart
   counter and cgroup; unexpected exit/restart fails even if the unit is active
   again. A successful `systemctl` child alone is not application evidence.
5. Run pinned headless Chromium in the guest against guest loopback. Capture all
   context traces, errors, responses and local 5xx. Real Git, native `node-pty`,
   SDK tools and packaged fonts/assets are exercised.
6. Stop the unit, observe inactive state and empty/absent descendant cgroup,
   collect journals and preserve the per-group manifest. Do not start another
   group against an unsettled service.
7. Verify a real service restart retains the last group's session data. Export
   evidence before tearing the VM down.

The VM has no host port forwarding or unrestricted external network. The package
and test support are read-only store inputs. No host session/account/credential
files, installed service, developer `.next` or source/dependency copies are used.
Only synthetic provider data and deterministic fixture providers are present.
Normal browser acceptance does not require real provider access.

Application-source helpers and generated fixture extensions resolve against the
**installed package**, not a source checkout. Live file tests modify synthetic
project Markdown/session files, not application code; they remain valid under
production execution without HMR.

## Diagnostics and settlement

Fresh execution prints its private `/tmp/pwv-*` root. `driver.log`, JUnit and
`run.json` identify the exact driver, selection, timestamps, outcome, observed
settlement and bulk cleanup. Guest evidence contains the system journal and one
directory per group:

- `run.json`: package root, fixture root, status, original service generation,
  stop/cgroup evidence and `resourcesSettled`.
- `suite.log`, `server.log`: original test output and service journal.
- `events.jsonl`: browser console/page errors, failed requests, local 5xx,
  context/trace operations and requested/observed service lifecycle events.
- `context-N.zip`: a trace for every context, on success and failure; failed
  contexts also receive bounded screenshot attempts.

Browser assertions keep their existing deadlines. Browser/context acquisitions,
trace exports and service stop operations have separate bounded diagnostics;
resource uncertainty or failed collection fails acceptance rather than authorizing
cleanup. Expected conflicts must be individually corroborated; no blanket retries,
5xx/console suppression, forced clicks or longer deadlines to hide contention.

After driver/descendant settlement, the owner removes only its own pinned runtime,
temporary and cache directories, including VM disks/exchange copies. Evidence is
separate and retained. Interrupted/uncertain runs retain bulk. A cleanup refusal is
reported, not silently accepted. Existing failed roots and other tasks' resources
require separate bounded cleanup authority; see the [retention policy](../docs/testing.md#diagnostics-and-retention).

Core harness/service-owner regressions run in `checks.core`. Those contract tests
are not browser acceptance, and VM acceptance grants no host operation authority,
integration, publication or deployment permission.
