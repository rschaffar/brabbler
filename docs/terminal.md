# Workspace Terminals

The Explorer terminal action opens or focuses a terminal for its selected cwd
in the right panel's outer tab bar beside **Files**. Each terminal tab keeps the
cwd it was created with. Files has its own independently split tab groups;
terminal hosts remain outside that geometry. Terminal panels stay mounted behind
inactive tabs, hidden panels, file splits/moves and session or project switches.
File splitting never duplicates or starts a terminal.

## Lifecycle

- Each new tab generates a random terminal ID before creation. Creation with
  the same ID and cwd is idempotent, including React Strict Mode's repeated
  effects. An existing ID cannot be reused for another cwd.
- `sessionStorage` retains terminal IDs, cwds, and the active terminal layout
  across refresh. Restored tabs first check the existing server instance and
  never silently start replacement processes after expiry or server restart.
- A new PTY gets a 120-second connection lease. Subscribing cancels expiry;
  the last subscriber leaving starts a new 120-second grace period. This also
  collects creations that never establish their initial connection.
- Hiding a panel, switching tabs, and unmounting a component only disconnect
  clients. Explicitly terminating a tab disconnects its event stream immediately
  and prevents pending creation or browser lifecycle callbacks from reconnecting.
  It still waits for creation and in-flight input before deleting the PTY.
  Restart waits for termination before creating a new ID. Failed termination
  leaves the tab available to retry; explicit reconnect checks the same ID and
  never silently creates a replacement shell.
- A shell exit closes the SSE stream and retains its output and exit code in
  the browser. Unobserved server records expire after the same grace period.
- Explicit termination and expiry signal the shell, escalating to SIGKILL after
  two seconds if it ignores SIGHUP. Server shutdown force-kills shells immediately.

## Process-wide SSH agent

Supported launchers install one stable private `SSH_AUTH_SOCK` before children
start, initially **No agent / SSH setup needed**. **Settings → SSH → Use agent**
explicitly selects the Browser agent, startup system agent, discovered/named
socket, or No agent. Existing inheriting PTYs retain the same pathname through
switches; Pi Web does not change the host's selector. Explicit shell/profile
exports and SSH `IdentityAgent` remain deliberate overrides. No agent is not a
prohibition on private-key files or other authentication methods.

Browser credentials are centrally registered public metadata, not session
bindings. Connect an explicitly selected key/device after fresh verification;
signature requests appear in global nonmodal Review/Approve cards without opening
Settings or taking terminal focus. Closing Settings does not disconnect the signer.
Strict verification is default; optional application unlock is fixed at 30 minutes
and every signature still requires presence. A locked Unlock and approve uses a
fresh UV unlock challenge followed by the separate SSH signing ceremony.

PTYs retain the public socket but omit `PI_WEB_PASSWORD` and the private
`PI_DESK_SSH_RUNTIME` control locator. Legacy session-binding markers are ignored
by managed commands and retained as migration evidence, never routing authority.
See [browser SSH](browser-ssh-agent.md) for security/compatibility boundaries and
the [completed implementation record](plans/archived/2026-10-22_process-wide-ssh-agent-plan.md) for
acceptance evidence.

## Appearance and touch keys

The header's light/dark switch changes only the terminal, defaults dark, and persists best-effort as `pi-web:terminal-theme`. Open terminals share the browser choice; storage events synchronize other tabs. Failed persistence keeps the in-tab choice. Theme changes update live xterm options, not PTY/SSE ownership. The retained Nerd/System font selector (`pi-web:terminal-font`) is independent. **Nerd** keeps the bundled Pi Web Nerd Font family; **System** follows the shared monospace family in General → Fonts & layout, with its original fallback stack. Both modes follow the shared monospace base weight (100–600); terminal bold remains 700. Family/weight changes update xterm and refit live, including after hidden terminals become visible, without recreating a PTY or SSE stream. Font-family and weight resets are separate and never reset the terminal's mode, palette or shared size. Hidden terminals defer metric-option application until measurable. The lifetime-owned resize helper forces glyph remeasurement through public size options before fitting, and best-effort font readiness can refit the same instance; old completions cannot affect replacement terminals. This also handles xterm's DOM-measurement fallback, which otherwise retains stale nonzero dimensions while hidden.

Settings → General → **Chat & terminal font size** also adjusts the terminal: chat 14 means terminal 13px, with 12–24 chat mapping to 11–23 terminal. There is no separate size preference. Changes refit through the existing resize writer, including after a hidden terminal becomes visible, without recreating the shell or stream.

Coarse-pointer portrait devices get two seven-key rows below the terminal, taking actual grid height rather than overlaying output. ESC, TAB, punctuation, Home/End, arrows and paging follow xterm's application-cursor mode. Ctrl/Alt are one-shot and also apply to the next software-keyboard character. Keys retain input focus and pass through the existing serialized writer; they never retry ambiguous delivery. Repeat timers stop on release/cancel/leave/unmount, including hiding the active toolbar.

## Transport

Output events carry a monotonically increasing UTF-16 offset in SSE `id`.
Reconnections use `Last-Event-ID` (or `after` on an explicit reconnect) and send
only the missing suffix. The server keeps at most 128 KiB of UTF-16 code units;
an older cursor triggers a terminal reset and bounded history replay. This is
bounded output history, not a serialized full-screen terminal snapshot. Slow
SSE consumers are disconnected once their response queue fills.

Input and resizes are serialized. A mobile keyboard can shrink xterm to one row: client resizes clamp columns/rows to at least two, and the command route accepts integer row 1 and forwards row 2. Zero, fractional, nonnumeric and over-limit dimensions remain rejected; unrelated write failures still disable input rather than retrying commands. Pending adjacent input is batched so remote
connections do not require one round trip per keystroke; large pastes are split
without splitting Unicode characters. Failed input is not retried because its
delivery may be ambiguous. Reconnect attaches to the same process with a fresh
writer; restart explicitly replaces the process. Initial/restored connections do
not require `navigator.onLine`: a reachable local application can work while the
browser reports no external network. Actual HTTP/SSE failures still determine
connection state; closing, disposal and same-ID restoration guards remain binding.

`bin/prepare-terminal.js` repairs node-pty 1.1.0's macOS spawn-helper executable
bits during installation, including published/npm-installed Pi Web packages.

Pi Web pins node-pty to `1.2.0-beta.15`, which includes Linux x64 and ARM64
prebuilt binaries. Native module loading is deferred until terminal creation,
so missing or incompatible binaries produce a JSON error with repair instructions.
Empty or non-JSON API errors show the HTTP status and direct users to the server log.

If a native binary cannot load, run
`npm rebuild node-pty --build-from-source --ignore-scripts=false --foreground-scripts` from the
installation directory (for npx, the cache directory containing `node_modules`).
On Debian/Ubuntu, install `python3` and `build-essential` first. This forces a
source build instead of reusing a missing or incompatible prebuilt binary.
Restart Pi Web after repair.

## Verification

The [common baseline](testing.md) covers native PTY, lease, output cursor, input
queue and storage checks, plus controlled whole-component lifecycle callbacks.
Core lease fixtures retain their exact PTY records through expiry so teardown can
force-terminate an owned shell even after its registry entry is removed and mocked
timers reset. The ignored-HUP regression requires native exit, including on failure.
`nix run .#test -- core --file components/TerminalPanel.test.mjs` focuses those
callbacks and client contracts, including retained Nerd/System families and shared mono weights across hidden/visible refits. `nix run .#test -- e2e --group terminal` exercises
real PTYs, live shared font family/base/bold weights and pinned Chromium against the Nix-built production launcher in an
ordinary Nix sandbox. `nix run .#test -- service` separately proves a genuine HTTP
PTY and its shutdown ownership in the Home Manager service's closure-only guest.
The shared [browser harness](../e2e/README.md#diagnostics-and-settlement)
isolates HOME/XDG/agent/TMP, traces each context and records owned-service
settlement. Acceptance never uses the installed host service, a development
server or checkout build output. Retained-resource cleanup remains separate.
