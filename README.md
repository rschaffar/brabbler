# Pi Desk

**A personal coding workspace for Pi.**

Pi Desk brings conversations, agents, project files, terminals, and Git history into one local browser workspace. It runs on your machine and uses the configuration and session files of the [Pi coding agent](https://github.com/earendil-works/pi).

This is my personal project, shaped around the way I work. It started from [Pi Web](https://github.com/agegr/pi-web) by **agegr and its contributors**, and I now maintain my own branch independently. Pi Web provided the foundation; Pi Desk is where I continue developing the workspace for my own needs.

> Pi Desk is an independently maintained fork, not an official Pi Web release. The upstream npm package and hosted demo belong to Pi Web, not to this project.

[Getting started](#getting-started) · [Features](#what-is-on-the-desk) · [Development](#development) · [Credits](#credits-and-license)

![The upstream Pi Web interface, showing a conversation, tool calls, and project navigation](./docs/screenshot2.png)

*An inherited Pi Web screenshot of the interface this project builds on.*

## What is on the desk?

- **Conversations in context.** Browse and resume sessions grouped by project, search history, star useful chats, archive old work, and export conversations. Fork into a new session or branch within an existing one.
- **An overview of agent work.** See sessions that need input, are working, or are ready to review. Built-in subagents can handle focused tasks, with inspectable sessions and results. Their feature switch is off by default.
- **Project files beside the chat.** Browse files, preview source and documents, edit writable text files, and inspect changes without leaving the workspace.
- **Git history you can explore.** Switch between project worktrees and browse local branches, commit graphs, and split or unified diffs. The optional Git Workflow plugin is separate and disabled by default.
- **A terminal where you need it.** Open a workspace terminal alongside your files and conversations.
- **Models and accounts under your control.** Configure providers, choose models and thinking levels, and manage multiple provider identities with per-session selection and project defaults.
- **Session-local model speed.** Choose **Standard** or **Fast** beside Thinking for ChatGPT subscription models, independently of reasoning depth. Fast uses more subscription quota; the choice is saved per session, never as a global/browser default. See [Model speed](./docs/model-speed.md).
- **Questions that fit the browser.** Answer one question or a navigable set of mixed questions, revise choices or written alternatives, add separate details, and submit everything once. Same-tab drafts survive refresh while the request is pending. Saved interaction receipts let you review what was shown and decided without executing an action again. See [Browser questions](./docs/questions.md).
- **Your Pi setup, still yours.** Use Pi's existing sessions, settings, skills, and extensions rather than starting over in a separate hosted service.

The Activity view tracks runs managed by this app; it is not a monitor for unrelated Pi CLI processes. “Local” describes where the workspace runs—prompts still go to whichever model provider you select.

## Getting started

Run the code from **this repository** to use Pi Desk. Installing `@agegr/pi-web` from npm gives you upstream Pi Web instead.

### From source

Clone this repository, enter its checkout, and choose one of the following setups.

**With Nix on Linux:**

```bash
nix develop
PI_WEB_SKIP_VERSION_CHECK=1 npm run dev
```

The development shell provides pinned tools and prepares a worktree-local `node_modules` from the lockfile. The first setup needs the dependency sources; subsequent runs can reuse the Nix cache. Do not run `npm ci` over dependencies managed by this shell.

**With Node.js and npm:**

Use Node.js **22.19.0 or newer** in a checkout that does not use Nix-managed dependencies:

```bash
npm ci
PI_WEB_SKIP_VERSION_CHECK=1 npm run dev
```

Open **[http://127.0.0.1:30141](http://127.0.0.1:30141)**. If you have not configured a model provider, open **Models** to sign in or add an API key. The development server binds to loopback by default.

`PI_WEB_SKIP_VERSION_CHECK=1` disables the inherited upstream npm version checks and running-version reload prompts. It does not update this fork; update the source checkout deliberately.

### Inspecting Pi Web's own source

Installed packages include the first-party TypeScript/CSS source alongside the built app. In an ordinary Pi Web agent session, call `pi_web_source` when investigating Pi Web itself; it returns this installation's package path and version so the agent can read only the relevant files (`app/`, `components/`, `hooks/`, `lib/`, `plugins/`). No source text is added to the prompt automatically. Chat-only sessions do not load this tool. The installed copy is a reference, not a checkout for edits.

### Nix installation

For an installed application rather than a development server, the flake provides a package and launcher for x86_64/aarch64 Linux and aarch64 macOS. From a committed checkout:

```bash
PI_WEB_SKIP_VERSION_CHECK=1 nix run . -- --no-open
```

To install that checkout into your Nix profile:

```bash
nix profile install /path/to/checkout#pi-web
PI_WEB_SKIP_VERSION_CHECK=1 pi-web
```

These are production-package operations and may build the application. They are not part of the normal development loop. The output is a Nix package, not a separately published Pi Desk npm package.

On Linux, the flake also exports a Home Manager module:

```nix
{ inputs, pkgs, ... }: {
  imports = [ inputs.pi-web.homeManagerModules.default ];
  services.pi-web = {
    enable = true;
    package = inputs.pi-web.packages.${pkgs.system}.default;
    environment.PI_WEB_SKIP_VERSION_CHECK = "1";
  };
}
```

Point the `pi-web` flake input at your chosen revision of **this repository**. The module runs a loopback-only user service; credentials remain outside the Nix store. For password-protected or proxied deployments, use a runtime `environmentFile` for secrets and configure TLS separately.

## Configuration and local data

The project name is Pi Desk, but the code still uses inherited `pi-web` command names, package metadata, `PI_WEB_*` environment variables, and storage paths. Those names are retained for compatibility; this README does not rename the application internals.

| Setting | Purpose | Default |
| --- | --- | --- |
| `PI_WEB_PASSWORD` | Enable browser password authentication | Disabled |
| `PI_WEB_ALLOWED_HOSTS` | Allow additional exact proxy or custom hostnames | Unset |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable inherited upstream version checks and reload prompts | Unset |
| `PI_WEB_IDLE_TIMEOUT_MS` | Idle-session eviction delay; `0` disables it | `600000` (10 minutes) |
| `PI_CODING_AGENT_DIR` | Override Pi's agent-data directory | `~/.pi/agent` |

The installed `pi-web` launcher supports `--port`, `--hostname`, and `--no-open`; use `pi-web --help` for details. `PORT`, `PI_WEB_HOSTNAME`, and `PI_WEB_NO_OPEN` are its corresponding environment options. The `npm run dev` script has its own fixed loopback address and port.

Provider requests honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.

### Sessions and provider accounts

Pi Desk reads Pi's local session files and shares its default model settings and credentials with the CLI. Back up your agent-data directory before experimenting with sessions or configuration you care about.

Additional provider accounts are stored in `~/.pi/agent/pi-web-accounts.json`. Sessions save opaque account IDs, not the credentials themselves. A session bound to a deleted account fails rather than silently using a different identity. Changing a project's account default affects new sessions, not existing ones.

Treat account files, API keys, session histories, and interaction receipts as private. Do not commit them to this repository or include them unredacted in issue reports. File drafts survive switching tabs, but are not persisted across a browser reload.

### Hidden projects in Activity

Use **Settings → General → Privacy → Hidden projects** to exclude selected projects from Activity. Search by name or path; each switch saves immediately and covers the project's worktrees and subagents, including descendants working in another project. Hidden projects disappear from Activity rows, project-filter options and section counts, without stopping agents or acknowledging results.

The **eye button** beside Activity's project filter reveals hidden activity. Revealed rows carry a crossed-eye marker. Concealing a selected hidden project resets the filter to All projects. The reveal choice is saved in this browser's `localStorage` and survives focus changes, leaving Activity, mobile chat navigation and page reloads; it is not synced to other browsers or devices. If browser storage is unavailable, the choice lasts only while Activity remains mounted. Privacy loading or errors still withhold all Activity rows without resetting the choice.

Project choices are shared across browsers through the private, versioned `~/.pi/agent/pi-web/hidden-projects.json` file (`PI_CODING_AGENT_DIR` applies). Other clients refresh on focus/visibility return and every 15 seconds while visible. Missing storage means no hidden projects; unreadable/corrupt settings withhold Activity and offer Retry rather than showing private rows. Saved hidden entries remain editable even if their sessions disappear. While any project is hidden, sessions with unresolved project identity or missing subagent ancestry are also withheld until metadata arrives (or explicitly revealed); provisional worktree paths are not offered as separate settings entries.

**This is Activity-only concealment, not an access-control or global screen-sharing mode.** The sidebar, Starred, open chats, toolbar activity indicators and desktop/push notifications remain unchanged. Check those surfaces before screen sharing.

### Remote access

**This is a coding agent with access to your machine, not a public chat service.** Keep it on loopback unless you deliberately configure remote access.

For an installed launcher on a trusted network, require a long random password before binding to a non-loopback address:

```bash
PI_WEB_PASSWORD='replace-with-a-long-random-password' \
PI_WEB_SKIP_VERSION_CHECK=1 \
pi-web --hostname 0.0.0.0 --no-open
```

A password does not encrypt HTTP traffic. Use HTTPS through a trusted reverse proxy or a trusted VPN. For a proxy, add its exact external hostname to `PI_WEB_ALLOWED_HOSTS`; this does not change the bind address. Keep real secrets in a protected runtime environment, not in source files or Nix options.

## Development

This project follows my personal workflow rather than promising a fixed release schedule or feature roadmap. If you use it, expect it to evolve as that workflow changes. Upstream is not responsible for supporting this fork.

Read [AGENTS.md](./AGENTS.md) for repository workflow rules and
[Architecture](./docs/architecture.md) for the source map. [Testing](./docs/testing.md)
owns the verification baseline and change-dependent acceptance matrix.

On Linux, one complete isolated run satisfies common core tests, type generation,
typecheck and lint—do not run the ordinary npm baseline in addition solely for
its spelling:

```bash
nix develop -c node nix/test-offline.mjs
# Focused tests; repeat --file for multiple exact paths:
nix develop -c node nix/test-offline.mjs --file lib/worktree.test.mjs
```

The isolated runner defaults to eight bounded file workers; `--jobs N` accepts 1–32. Do not append Node concurrency flags to `npm test`: options after its globs do not control Node. Browser and terminal acceptance are separate:

```bash
npm run test:e2e
npm run test:terminal
```

**Never run `next build` or `npm run build` during normal development.** Builds write to `.next/` and can interfere with the development server; reserve them for installation or release work. Manual development reuses a healthy matching server. Acceptance instead requires a free checkout lock and owns an isolated free-port server; it never substitutes or restarts the installed service.

For Nix dependency changes, use `nix develop .#update` and `npm install --package-lock-only`, update the dependency hash in `nix/npm-deps.nix`, and deliberately move the old managed `node_modules` aside before re-entering the default shell. Never overwrite an unmanaged dependency tree to bypass a shell refusal.

### Further reading

- [Testing and isolation](./docs/testing.md)
- [Browser tests](./e2e/README.md)
- [Worktrees and Git Explorer](./docs/worktrees.md)
- [Optional Git Workflow plugin](./docs/git-workflow-plugin.md)
- [Workspace terminal](./docs/terminal.md)
- [Internationalization](./docs/i18n.md)
- [Inherited release tooling](./docs/release.md)—not an authorization to publish under upstream's package name

Some guides still use the Pi Web name. They describe the inherited implementation and the independently maintained changes in this checkout.

### Repository layout

```text
app/          Next.js UI and API routes
components/   React UI components
hooks/        Client state and interaction hooks
lib/          Session, agent, model, file, Git, and security core
plugins/      Optional bundled plugins
public/       Static assets and PWA files
bin/          Inherited pi-web launcher
nix/          Packaging and isolated developer checks
docs/         User guides, contributor notes, and design decisions
e2e/          Browser and terminal integration tests
demo/         Inherited standalone demo source
```

## Credits and license

Pi Desk exists because of the work that came before it:

- **[Pi Web](https://github.com/agegr/pi-web)** by **agegr and its contributors**—the original browser UI and the foundation of this fork. Thank you for making it open source.
- **[Pi](https://github.com/earendil-works/pi)**—the coding-agent runtime and SDK this workspace runs on.
- **[pi-ask-user](https://github.com/edlsh/pi-ask-user)**—the foundation of the browser-native question adapter ([MIT notice](./lib/ask-user.LICENSE)).
- **[binaryplease/git-graph](https://github.com/binaryplease/git-graph)**—the adapted active-lane graph-layout algorithm ([MIT notice](./lib/git-graph-layout.LICENSE)).

This fork is maintained independently. Credit for the original project remains with its authors; the changes maintained here do not imply upstream endorsement or support.

Licensed under the **[MIT License](./LICENSE)**. The original copyright notice and the bundled third-party license notices are preserved.
