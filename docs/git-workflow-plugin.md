# Optional Git Workflow plugin

Pi Web works with every bundled plugin disabled. **Settings → Plugins → Git
Workflow** enables this browser-only bundled plugin; it is off by default.
Ordinary coding/shell tools, Git Explorer and standalone worktrees do not depend
on it. The removed managed Workflow and its private data are not restored or read.
There is no CLI integration, task registration, reservation, quarantine,
reconciliation, evidence-receipt protocol, marketplace or frontend code loader.

## Settings

The plugin declares schema version 1 and defaults. Pi Web stores only explicit
overrides in `~/.pi/agent/pi-web/plugins/git-workflow/settings.json` (relative to
`PI_CODING_AGENT_DIR` when configured), using owner-only directories/files and
locked atomic writes. No settings are stored in the repository or session.

Resolution is **built-in → global → project**. The canonical physical common Git
directory identifies a repository, so linked worktrees share overrides. Projects
can replace global action permissions, target, method and checks. Enablement is
global-only: disabling prevents all new plugin execution in every project.
The panel shows the effective value and its origin beside each field. **Use
global default** deletes a project override; **Use built-in default** deletes a
global override. Explicit false, null and empty check arrays are not inheritance.
There are no chat overrides or extra Apply step. Saving a field changes subsequent
invocations immediately; settings do not schedule any work. No tool can change
settings. Agents must not use shell/API access to change their own permissions.
The same authenticated host/origin boundary as other Pi Web settings applies;
this plugin is not an OS sandbox for an agent that already has shell access.

Each of `commit`, `rebase`, `merge`, `createWorktree`, `attachWorktree` and
`removeWorktree` has exactly one **deny / ask / allow** setting, default **ask**:

- **deny** refuses before preview or checks.
- **ask** displays the selected resources, captured full refs/tree, exact message,
  Git arguments and required check commands, then waits for an explicit answer.
  That approval covers those checks and the operation, not future invocations.
- **allow** executes without an approval question, with the same validation.

Target local branch defaults to null (choose one before rebase/merge). Merge
method defaults to ordinary non-FF; FF-only is the other choice. Required commit
and merge checks are named shell commands, default empty arrays. Edit them as JSON,
for example `[{"name":"Tests","command":"npm test"}]`. Commands run with a
sanitized Git environment, at most 120 seconds and 2 MiB captured output per check.
Commit checks run in the selected checkout, including its current staged/unstaged
contents; they do **not** certify a separately exported staged tree. Merge checks
run in the registered clean feature checkout **before** merging; they do not test
a predicted merged result. Both locations are disclosed in Ask previews. A failed
or state-changing check stops the Git operation and reports possible check effects.
Stronger user/repository instructions always apply, including separate approvals
or additional verification they require even when a plugin permission is Allow.

## Tools and correctness

Tools are ordinary Pi inline-extension tools, exposed only to ordinary Pi Web
coding sessions while enabled. Chat-only sessions and subagent profiles do not
load them. Each invocation explicitly selects an absolute `checkout` root in
**any local repository**, independently of the session cwd. The caller may be
in another repository or outside Git entirely; it does not move or adopt the
selected checkout. The path must resolve to a physically registered root in its
own repository, not a subdirectory, bare repository or arbitrary Git directory.

Permissions, target branch, merge method and required checks resolve through
built-in → global → **selected repository** overrides. The caller project's
permissions and recipes are neither imported nor used to authorize the selected
operation. Pending approvals follow the selected settings, and changing those
relevant settings cancels them. Global disable still stops all new plugin calls.
Related base/feature/removal checkouts must remain in the selected repository;
registration and captured physical identity/state are rechecked before effects.

- `git_commit`: `checkout`, `mode: files | staged`, exact `message`; Files also
  supplies literal whole-file paths. Files commits their full working contents,
  including unstaged edits, and preserves unrelated staging. Staged commits the
  entire index and preserves unstaged content. A native `index.lock` protects
  whole-file effects while a temporary index is reconciled by Git's `--only`;
  no destructive reset is used. Initial/unborn repositories are not supported.
- `git_rebase`: `checkout` of `featureBranch` onto the configured local target.
  Both branches must differ. No autostash, update-refs of other branches, automatic
  merge-preserving rebase, hidden retry or conflict cleanup.
- `git_merge`: target `checkout` and `featureBranch`; uses captured local refs and
  the configured method. No automatic rebase, method fallback, squash, cleanup or
  remote operation. Per-branch mergeOptions cannot change the selected method.
- `git_worktree`: action `createWorktree | attachWorktree | removeWorktree`, source
  `checkout`, explicit absolute `path`; create/attach also supply `branch` and
  `baseBranch`. Create requires a new branch; attach requires that same existing
  local branch as base. Destinations are directly under `<main>-worktrees`.
  Removal never deletes a branch and refuses main/caller/source checkouts
  (including a caller cwd below that checkout's root), dirty/untracked or ignored
  content. There is no force removal or post-merge cleanup.

Effects are unsigned and hook-free, as disclosed in previews. Rebase/merge use
Git's native conflict behavior; conflict state remains for explicit human/agent
resolution. Sparse checkouts, hidden index flags and clean/process filter
attributes (including LFS) are refused: even status/preview could otherwise run
project commands before approval. Preview uses an ephemeral index and may add
unreachable Git objects, but never stages working files. The supplied rebase/merge
patch shows feature changes since the merge base, **not** a predicted result.
Approval patches appear as stacked collapsible file diffs, with the first file
expanded, change types/counts, Expand all / Collapse all and one shared
side-by-side/unified/raw control. Collapsed diffs are not mounted; other expanded
files render when scrolled near view. Binary and metadata-only changes remain
explicit; oversized individual diffs fall back to their complete raw file patch.
The complete supplied raw patch is always available, and unsupported multi-file
framing falls back to it without omitting files. Bounded-read failures refuse
rather than silently truncating approval data.

Current permissions, relevant settings, checkout/ref/index/file state are checked
again after approval, between checks and immediately before the native effect.
No Git lock is held while waiting for approval. External filesystem/ref writers
can still race the final checks; this is not an atomic repository snapshot or a
reservation. Stale operations refuse only that invocation, never other sessions.
Native writes have no Stop/disable signal or output-buffer kill. Once started,
they settle honestly; failures report whether checks/native effects started and
observed HEAD/status/worktrees, with no rollback, hidden retry or cleanup.

## Browser surfaces and toggle lifecycle

`lib/plugins/registry.ts` is the static server composition root; dependencies point
from bundled plugins to core. Core chat/session code knows only generic plugin
extensions and cards. `components/plugin-ui/` presents text, Markdown, bounded generic structured fields
and sections, supplied patches and action buttons. The Git plugin supplies its
operation summaries; core never interprets a text dump or embeds Git permission
logic. Presentation is not model-facing tool content.

Approvals share the compact blocking-card shell with browser questions and
ordinary extension select/confirm/input/editor requests: bounded body scrolling,
fixed action footer and collapse/expand preserving local state. Git cards show
checkout/branch and operation-specific fields, the exact commit message, required
checks, visible operation notes and the whole-operation approval scope. Full refs,
candidate tree and native arguments are under Technical details. Cancel cancels
the pending request; Reject answers its declared reject action. The prominent
operation-specific action approves the entire candidate and listed checks, never
just an expanded file. Worktree approvals use the same layout without patches.

Cards use the existing per-session pending-dialog maps and `extension_ui_response`
transport. Only an action declared by the matching live request can resolve it.
SSE reconnect replays pending cards; Dismiss/Escape, Stop and wrapper teardown
cancel them. Disable or relevant settings changes cancel waiting Git approvals;
Pi's supported dynamic registration/hidden exposure removes active tools and their
guidance immediately. Re-enable registers them without rebuilding the session.
Native effects already started are not interrupted. Historical cards/tool results
are never execution authority, and a server restart cannot reconstruct an approval.
Settings and transcript history may remain for re-enabling.

## Verification

Core tests remain separate from expensive Git integration tests. See
[Testing](testing.md) and [browser fixture notes](../e2e/README.md). From a prepared
Linux worktree, with no dev server owning that checkout:

```sh
nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs
# Separate plugin tests: disposable repos + real Pi registration/toggle lifecycle.
nix develop --offline --no-write-lock-file -c sh -c \
  'env -i PATH="$PATH" LANG=C.UTF-8 PI_OFFLINE=1 node --experimental-strip-types --test "plugins/**/*.test.mjs"'
# Plugin-only desktop/mobile browser acceptance (no model calls):
nix develop --offline --no-write-lock-file -c sh -c \
  'env -i PATH="$PATH" PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" LANG=C.UTF-8 PI_OFFLINE=1 E2E_GIT_WORKFLOW_PLUGIN_ONLY=1 npm run test:e2e'
```

The ordinary `npm test`, typecheck and lint commands are unchanged. The Nix
exporter includes `plugins/` source for typecheck/lint without adding expensive
plugin tests to the core runner. CI explicitly runs the separate plugin Node
selection and separate `core`/`git-workflow-plugin` browser matrix entries on every
PR, including shared-core changes. Browser CI uses dev, never a production build.
Implementation/verification do not authorize integration, publication, deployment
or feature-resource cleanup.
