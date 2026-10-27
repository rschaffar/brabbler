# Brabbler demo

A static, backend-free copy of the Brabbler UI for GitHub Pages. It uses the
real Brabbler components, and an in-browser mock answers every `/api/*` request
the UI makes, so visitors can click through sessions, files, models and
settings without installing anything.

## What visitors see

- **Sessions**: a set of English tutorial conversations that explain the layout, files and `@` mentions,
  models and reasoning levels, branching, tool calls, skills/plugins/subagents
  and composer shortcuts. A second project shows project switching and a
  *Chat only* session.
- **Files**: the explorer browses a snapshot of this repository. The Welcome
  session opens `README.md` as a rendered preview on the right, and the
  tutorial edits show up as Git changes with diffs.
- **Models**: a signed-in ChatGPT Plus/Pro (Codex) account, a DeepSeek API key
  and a custom "Claude Gateway" provider from `models.json`, with Codex, Claude
  and DeepSeek models in the picker.
- **SSH**: global Settings navigation with an explicitly unavailable illustration;
  every action is disabled, without example credentials, signers or requests.
- **Interaction**: sending a message streams a canned reply (with a real `read`
  or `ls` tool call when it fits), and `!command`, the terminal panel, forks,
  branches, renames and titles all work in memory. Anything that needs a real
  server (sign-in, installs, uploads) explains that this is a demo.

## How it works

```text
app/DemoRoot.tsx        imports mock/install.ts, then renders Brabbler's AppShell
mock/install.ts         replaces window.fetch (for /api/*) and EventSource
mock/router.ts          the API routes: sessions, agent, files, git, models, …
mock/agent.ts           streams replies with pi's SSE event sequence
mock/sessions/          tutorial scripts, expanded into pi session entries
mock/captured/          inherited Pi Web + Pi SDK captures, adapted for this Brabbler demo
scripts/prepare-demo-files.mjs
                        snapshots the repository into public/demo-files
```

`components/`, `hooks/` and `lib/` are copies of the main project. These files
differ from their originals:

| File | Why |
| --- | --- |
| `app/layout.tsx`, `app/page.tsx`, `app/DemoRoot.tsx` | Load the mock, no service worker or manifest |
| `components/AppShell.tsx` | Open the README preview by default, base-path-safe `router.replace`, in-browser "Full history" |
| `components/ChatWindow.tsx`, `FileIcons.tsx`, `ProviderIcon.tsx` | Prefix static assets with the Pages base path |
| `components/FileViewer.tsx`, `FileExplorer.tsx`, `MarkdownBody.tsx` | Load images, media and downloads from the static snapshot |
| `lib/subagent-extension.ts`, `lib/terminal-manager.ts` | Types only; the originals are server code |

To pick up UI changes from the main project, copy the updated files over and
re-apply the changes above (search for `demo` / `@/mock` in those files).

## SSH illustration boundary

Do not copy/mount the production SSH controller, client, registry, agents, API
handlers or signing cards into this static demo. Its AppShell adds navigation
only; SettingsPanel renders disabled, handler-free controls. Shared SSH English
messages are display copy. No WebAuthn ceremonies, discovery, management or SSH
notifications run. The password-disabled web-auth mock is unchanged; every
`/api/ssh-agent` method/action returns a demo-only 501 before session/body work,
never fabricated signing authority. Fetch interception alone is not protection
against native credential calls.

There is no UI-regeneration command: checked-in UI copies are maintained manually.
`prepare-demo-files.mjs` refreshes only ignored file-browser assets, not executable
UI modules. Application Nix acceptance excludes this separate demo; this SSH
synchronization is source-reviewed, not a demo browser/build pass. Its independent
CI remains responsible for demo verification; deployment is separately authorized.

## Isolation from Brabbler

The demo never ends up in the app or its npm package:

- **Not published.** The root `package.json` publishes only the paths in its
  `files` whitelist, so `npm pack` contains nothing from `demo/`.
- **Not compiled into the app.** Brabbler imports nothing from `demo/`; the root
  `tsconfig.json` excludes it and `eslint.config.mjs` ignores it.
- **Kept out of the app's CSS.** Tailwind scans every file that isn't
  gitignored, so `app/globals.css` has `@source not "../demo";`. The demo's copy
  of `globals.css` keeps the same line, where it points at nothing.
- **Its own CI.** Only `.github/workflows/demo-pages.yml` installs and builds
  `demo/`.

## Commands

Use Node **24** (the Nix/CI baseline is **24.21.0**, minimum **24.0.0**).
The demo's independent compiler and Node typings are TypeScript **6.0.3** and
`@types/node` **24.19.2**, matching the root baseline.

```bash
cd demo
npm install
npm run dev      # http://127.0.0.1:30142
npm run lint
npm run typecheck
node --experimental-strip-types --test lib/session-search.test.mjs
```

Normal verification uses type generation (`node_modules/.bin/next typegen`),
typecheck, lint and the focused search regression tests above. Do not run a
production/static build during normal development. `npm run build` produces
`out/` only for separately authorized deployment/release work.

`npm run dev` and `npm run build` first run `scripts/prepare-demo-files.mjs`.
To preview the build under a sub-path the way GitHub Pages serves it, set
`PAGES_BASE_PATH=/brabbler` before `npm run build`.

## Deployment

`.github/workflows/demo-pages.yml` builds the demo on every push to `main` and
deploys `out/` to GitHub Pages. Enable Pages once under **Settings → Pages →
Source: GitHub Actions**; the site is then served at
`https://<owner>.github.io/<repo>/`.
