# Pi Web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local browser UI for the [pi coding agent](https://github.com/earendil-works/pi). Pi Web uses the same local configuration and session files as pi, so you can browse and resume conversations, run agent turns, configure models and resources, and inspect project files from a browser.

**[Try the interactive demo →](https://agegr.github.io/pi-web/)** The real Pi Web UI runs entirely in your browser, with sample sessions, files and models. There is nothing to install; replies are pre-written and no model is called.

![Pi Web displaying a pi session with structured Markdown, tool calls, and project navigation](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## Features

- **Session workspace**: browse, resume, rename, archive, restore, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Activity overview**: triage Pi Web-managed sessions and subagents across projects by requests for input, working and queued runs, and results not yet reviewed across devices using this server. Open a row to answer in the existing chat; desktop keeps the queue alongside it, while mobile provides a back-to-Activity path. External Pi CLI, Herdr, and remote agents are not monitored.
- **Starred sessions**: starred chats show ★ beside their names in project lists and live in a separate ⭐ top-bar view (not in Activity). Filter by project, open a chat, or unstar it there; live **Needs you** and **Working** labels appear on starred rows. Stars are saved on the server in `~/.pi/agent/pi-web/starred-sessions.json` and shared across browsers connected to that server. Existing browser-local stars are imported on first visit.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Session references**: use **Copy session link** on a saved session row to copy a `/?session=<id>` URL. It opens that chat in this Pi Web instance; paste it in a prompt to give the agent a recent, bounded excerpt of that saved conversation (up to three links per prompt). Only user/assistant text from the active branch is included, up to 20 messages, 1,200 characters per message and 8,000 characters per session. Tools, images, thinking and other branches are excluded. The link is resolved against this server's local sessions, not a remote Pi Web; missing sessions are reported to the agent as unavailable. The context is stored as a hidden session message and may remain in later model context. Treat referenced conversations as untrusted data; do not paste links to conversations you don't want sent to your model.
- **Project file tools**: browse and upload files, edit and save writable text files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees and session workflow**: choose a worktree and browse local branches, the read-only commit graph with local tag labels, and adjacent commit details and side-by-side diffs in the Git Explorer panel beside chat (or without a chat); set project/new-chat or per-chat Git preferences; create and continue/fork worktrees manually or through an explicit agent action followed by an idle post-run transition; preview/confirm selected whole-file commits; verify saved checks, review whole/commit/range diffs, and separately approve an exact local non-fast-forward merge. No automatic integration or remote publication.
- **Workspace terminal**: open it from the File Explorer toolbar. It defaults to a bundled JetBrains Mono Nerd Font (no browser font installation needed); use the terminal header to switch to the system font. The choice is saved in browser storage.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Pi Web.
- **Browser-native `ask_user`**: answer agent questions with described choices, multi-selection, freeform text, and optional comments without a terminal-style popup.
- **English, Simplified Chinese, and Traditional Chinese UI**: Pi Web follows the browser language initially and provides a language switcher in the top bar. In **Settings → General**, the separate **Generated title language** setting chooses Auto, English, German, Simplified Chinese, or Traditional Chinese for all future Generate title actions. This preference is saved on the server in `~/.pi/agent/pi-web/title-settings.json` and shared by browsers using that server; it does not rename existing sessions or change the UI language.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`, then run:

```bash
npx @agegr/pi-web@latest
```

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30141](http://127.0.0.1:30141). Pi Web listens only on `127.0.0.1` by default.

If no model provider is configured yet, open the **Models** panel to sign in or add an API key.

To install the `pi-web` command globally:

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

To update, stop the running process with `Ctrl+C` and run the same install command again. Tabs left open across a server update show **Reload Pi Web** when the server's running version differs from the page's version. This refreshes the page, not the agent session; confirm only after copying any unsent drafts or attachments, which are not saved across page reloads. A newer npm release alone does not trigger the prompt until it is installed and running. To uninstall, run `npm uninstall -g @agegr/pi-web`.

### Nix installation

The flake exposes `packages.<system>.pi-web` (and `default`) and `apps.<system>.pi-web` (and `default`) for x86_64/aarch64 Linux and aarch64 macOS. From a committed checkout, `nix run . -- --no-open` runs the built `pi-web` command directly; `nix profile install /path/to/pi-web#pi-web` installs it. Pin the flake input to the desired revision when deploying it elsewhere. The Nix build installs the production Next.js app and its runtime dependencies using a fixed-output npm dependency cache, pinned Node and a local Noto font. The Nix output is an executable package, **not an npm tarball**; npm remains a build tool inside the Nix sandbox. Production builds are for installation/release, **not** normal development.

On Linux, Home Manager users can import `inputs.pi-web.homeManagerModules.default` and enable `services.pi-web`. The module installs the same package and starts a loopback-only systemd user service; it does not configure a reverse proxy or manage credentials. For example:

```nix
{ inputs, pkgs, osConfig, ... }: {
  imports = [ inputs.pi-web.homeManagerModules.default ];
  services.pi-web = {
    enable = true;
    package = inputs.pi-web.packages.${pkgs.system}.default.override {
      piCli = inputs.llm-agents.packages.${pkgs.system}.pi;
    };
    allowedHosts = [ "pi.example.internal" ];
    environmentFile = osConfig.sops.secrets.pi-web-env.path;
    environment.SSH_AUTH_SOCK = "%t/ssh-agent/selected.sock";
  };
}
```

Only the installation-specific host, secret-file path, optional package/SDK match, and non-secret extras such as an SSH-agent socket need to live in the consuming Home Manager configuration. When migrating an existing service, remove its old `systemd.user.services.pi-web` definition and any duplicate `home.packages` entry for Pi Web; the module owns both. Keep password values in a runtime `environmentFile`, not a Nix option; configure TLS termination separately. Mutable sessions and accounts stay outside the Nix store. The module is opt-in and does not alter NixOS configuration by itself.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `pi-web --help` (or `-h`) to print startup options and exit without starting the server. Unknown options exit with an error.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable npm release checks and running-version reload prompts | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |

For example:

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Multiple model-provider accounts

Pi Web can keep additional OAuth and API-key identities for the same provider. The small account indicator beside the model shows the current model provider’s selected identity; open it to choose an **Account provider**, use **Session account** to switch an idle session, or use **New sessions in project** to set the default for newly created sessions. The popover always lists Pi default alongside additional identities for the chosen provider: use **Change login** for the default OAuth credential (or **Change API key** for an API-key provider), and rename or remove additional identities there. Press **Add account** to reveal the authorization form; otherwise it stays hidden. For providers with supported usage APIs, the list shows each authorized account's remaining weekly and 5-hour limits when reported, and the selected account's limits appear beside its name in the composer. Usage is fetched when viewing the accounts and can be refreshed manually; it is not continuously polled. In particular, `openai-codex` reports ChatGPT subscription quota windows; the separate `openai` API-key provider does not expose these limits, and API spend is not labeled as a weekly subscription quota. Device-code sign-in provides a clickable verification link, a Copy code button, and Cancel; keep the popover open or reopen it while authorization is pending. Linked Git worktrees share one project default. A new session can override it before its first message; changing the project default never changes existing sessions. Subagents inherit their parent session's account.

**Pi default** means pi's normal provider authentication (`auth.json` or its configured ambient sources), including for legacy sessions; the shared credential and the existing Models panel remain compatible with the pi CLI. Additional identities and project defaults live in `~/.pi/agent/pi-web-accounts.json` (or the directory selected by `PI_CODING_AGENT_DIR`), with file permissions limited to the owner. The account file contains credentials: protect and back it up as you would `auth.json`, and never commit it to a repository. Sessions persist only opaque account IDs, not credentials. Removing an identity leaves previously bound sessions unable to use that provider until you select another account; they never fall back to Pi default without an explicit switch.

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Notes

- **Agent data**: Pi Web reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Server restart recovery**: Open browser tabs return to their selected chat and reload its saved transcript. Pi Web cannot resume in-flight model output or tools after the server process stops. If a recorded prompt lacks a settlement after its server process exits, the chat shows a persistent **may have been interrupted** notice; check tool side effects before continuing. Dismissal is remembered across reloads. No prompt is automatically resent. New sessions whose first transcript was never flushed cannot be restored from recovery metadata alone. This detection covers Pi Web-submitted prompts, not runs started solely by extensions; an unknown outcome or reused live PID can suppress a warning. Records contain only run IDs, process IDs, and timestamps under `~/.pi/agent/pi-web/run-journal/v1/` (or `PI_CODING_AGENT_DIR`); deleting a session removes its records.
- **Session search**: The sidebar search filters conversations in the current project (including its linked worktrees) and the current Active or Archived view. Search matches titles, first-message previews, session IDs, and conversation text; message matches can jump to their location. Choose **All projects** or **Active and archived** explicitly to broaden the scope. Search reads a bounded number of recent session files, so a partial-results notice means there may be more matches; use **Refresh** to rerun after changes.
- **Session archive**: Archiving hides a session (and its subagents) from the active list and active search without moving or deleting its Pi session file. Switch to **Archived sessions** in the sidebar to open, restore, or delete it permanently. Opening an archived chat also shows a banner with a **Restore session** action that keeps the chat open. Stop a running session before changing its archive state. For bulk actions, click **Select** in the project's session list, check the session families (or **Select all** in the current active/archived view), then **Archive**, **Restore**, or **Delete**. Bulk delete requires a separate confirmation and permanently removes selected sessions and their subagents, but not independent forks. Running sessions cannot be archived; if an action fails, its session remains selected for retry. **Done** exits selection mode.
- **Move to project**: Use the session row action to select another existing project or browse to a folder, then confirm **Move**. This changes the saved working directory and relocates the session and its subagents; independent forks stay in their original project but retain their parent link. Stop running sessions first. If the moved chat is open, Pi Web closes it so you can reopen it in its new project. Archived sessions can also be moved.
- **Filesystem access**: Pi Web must be able to read the agent data directory and the working directories recorded by its sessions. Run Pi Web in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and Pi-default credential storage, so those changes are visible to both interfaces. Additional provider identities are Pi Web-only.
- **File access boundary**: the file browser is limited to working directories selected in Pi Web and project or session roots it already knows about; it is not a general filesystem browser. For writable UTF-8 text files up to 1 MB, use **Edit** in the open file's toolbar and **Save** (or Ctrl/Cmd+S in the editor). Edits are explicit, not autosaved; dirty drafts survive switching file tabs but not a browser reload. Closing a dirty tab or reloading the page prompts first. External file changes are not silently overwritten: a conflicting draft stays in the editor until you copy it or discard and reload. Read-only, symlink, media, binary, oversized, and session-reference-only files cannot be edited. Saves replace the file with a same-directory temporary file and preserve ordinary permission bits, but may change its owner, special mode bits, ACLs, and inode/hardlink identity; external filesystem writers can still race with the final replacement.
- **Git worktrees and Git Explorer**: see [Worktrees in Pi Web](./docs/worktrees.md) for switcher visibility, read-only commit graph and diffs for the selected checkout, explicit local base/tip creation, and removal behavior.
- **Git Workflow**: One **Workflow** panel beside Activity holds Global/Project/Chat×Project settings and field inheritance. Select another allowed project without moving the chat or retargeting its shell/file tools; identity-bound drafts survive project/scope/panel navigation. Agent `git_workflow` supports explicit-project status and read-only review (directory-bound comparisons currently require Linux). Cross-project mutations and standing authorization remain unavailable. Existing supervised commit/integration/workspace actions stay under **Existing chat actions · legacy compatibility**, tied to the chat checkout. Defaults are editable without starting a chat; applying them to a legacy task is explicit. Session Save/Apply stay unavailable while a run is waiting; a managed worktree task with no captured base can instead offer an exact-approved, create-only local-base proposal without saving settings or moving the chat. Git guidance is conditional: ordinary questions do not require status or setup calls. Live disablement and **Pause all** gate managed mutations, including loaded tools; they are not a shell sandbox. Managed commits support Off/Manual/Ask: `git_commit operation: commit` and the workflow alias share exact-candidate approval. **Permissions & blockers** shows the same task/actor checks as tool status, not a grant or completed Git preflight. **Task binding & source review** explicitly binds private request/workspace/source evidence without starting work or granting execution; secure source capture is currently Linux-only. Legacy session consent remains compatible. Checks and exact local non-fast-forward integration still require separate approval. Commits, reviews, checks and merges retain chat cards with captured, lazy multi-file split diffs outside model context; historical records cannot replay approvals. Automatic modes and agent cleanup are not yet implemented. See [Git workflow](./docs/git-workflow.md) for current behavior and [the revised design](./docs/adr/0011-policy-driven-git-tools.md) for project-policy-driven tools across worktrees/projects without mandatory session binding or relocation. Unsupported hooks/signing/filters, dirty indexes and unfinished Git operations fail closed; inspect partial results manually. No remote operations; Windows portability remains unverified.

### Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Pi Web preserves the
browser's native context menu. This hook is browser-side and independent of
Pi agent extensions.

### Git Explorer graph layout

The Git Explorer's small active-lane graph layout adapts [binaryplease/git-graph](https://github.com/binaryplease/git-graph) (MIT; see `lib/git-graph-layout.LICENSE`). It uses Pi Web's own local, guarded Git API; it does not install that project's separate server or expose its checkout actions.

### Browser-native `ask_user`

Pi Web includes a web-focused adaptation of [pi-ask-user](https://github.com/edlsh/pi-ask-user) v0.15.0 (MIT; see `lib/ask-user.LICENSE`). In ordinary web sessions and subagents that load extensions, it replaces the recognized external `pi-ask-user` package's tool, preserving its parameter names, answer/result format, and `ask:answered` / `ask:cancelled` events. The browser form uses Pi Web's existing per-session extension UI transport, so pending questions survive an SSE reconnect and expire or close on Stop. The standalone Pi terminal still uses its separately installed extension. Chat-only sessions load no extensions, including `ask_user`.

Terminal-only layout and shortcut options remain accepted for compatibility but do not alter the browser form. Unrelated extensions that also register `ask_user` are not silently suppressed; resolve those tool collisions explicitly.

### Activity overview

The ⭐ Starred button beside ◉ Activity opens a separate view of saved starred sessions, with its own project filter and a back-to-Starred path on mobile. Star/unstar using the project session list or the Starred view. Starred rows show live Needs you or Working status when applicable; Activity still owns the status and review queues.

Use the Activity button in the top bar to see **Needs you**, **Working**, **Queued**, **Possibly interrupted**, and **Ready to review** across projects; filter the list by project. Possibly interrupted lists saved Pi Web sessions with an unacknowledged restart-recovery record, even if their chat is not open. Open a row to inspect the saved chat and dismiss its warning when reviewed; the Activity row then disappears. This section refreshes while Activity is visible and on return to the browser; live activity takes precedence when the same session is running again. Needs you requires an actual pending extension question or interactive dialog. Ready to review includes settled Pi Web runs and subagents (without adding subagent completion sounds). The newest 1,000 distinct completed sessions and their review receipts are saved in `~/.pi/agent/pi-web/activity-review.json`, shared across browsers using that agent directory and retained across Pi Web restarts. Opening a result leaves it in Ready to review. Press **Read** on the row to acknowledge its known completion on the server; other visible devices update on their next poll. A newer run makes the session ready again. When upgrading from browser-local review state, timestamped receipts are imported where the server has a matching completion; unverifiable older unread markers are dropped rather than inventing historical completions. Live Needs you, Working, and Queued state remains in memory and does not monitor separate Pi CLI or Herdr processes; possible interruptions use the separate recovery journal.

### Extension Session Liveness

Server-side Pi extensions with detached work can prevent automatic idle
session eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive`
must be synchronous, cheap, and scoped to the supplied exact session id or
file. Provider errors fail safe by preserving that session. This lease only
affects automatic idle eviction; explicit shutdown and Stop fallback cleanup
still take precedence.

## Development

On Linux, use the lockfile-backed Nix shell in **each worktree**:

```bash
nix develop
npm run dev
```

Entering the shell builds dependencies from `package-lock.json` into the Nix store, then **copies** the built modules into this worktree's `node_modules` once per lockfile revision (reflinks where possible). Next/Turbopack rejects packages whose real paths escape the workspace root, so store symlinks and cross-checkout links do not work for Pi Web development. Re-entering with an unchanged dependency derivation reuses the local copy. Node.js, Git and Chromium for browser E2E are pinned by the flake. The first build needs package sources available; later invocations can reuse the Nix cache offline. If `node_modules` is already present but not marked as managed for this exact dependency build, the shell refuses to overwrite it; move it aside **deliberately** first. Never run `npm ci` over this managed tree. For dependency changes, use `nix develop .#update` and `npm install --package-lock-only`, update `nix/npm-deps.nix`'s hash, then move the old `node_modules` aside and re-enter the default shell. npm-only development remains possible for non-Nix contributors with a separate `npm ci` checkout.

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141); see [the browser test guide](./e2e/README.md). Each browser-test run uses temporary fixtures and a free local port. Managed Git verification drops the browser password and Next/PORT runtime variables before executing selected checks, but dependency isolation does **not** change cross-session Git admission, external writers, or failed-check recovery; those remain separate workflow decisions. Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build` or `npm run build` during normal development. It writes to `.next/` and can interfere with the development server; leave builds for release work.

Contributor guides: [Internationalization](./docs/i18n.md) and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
docs/            Focused user and contributor guides
demo/            Static browser demo published to GitHub Pages (see demo/README.md)
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE)
