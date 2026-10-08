# Optional Git Workflow plugin

Pi Web works with every bundled plugin disabled. **Settings → Plugins → Git
Workflow** enables this browser-only bundled plugin; it is off by default.
Ordinary coding/shell tools, Git Explorer and standalone worktrees do not depend
on it. The removed managed Workflow and its private data are not restored or read.
There is no CLI integration, managed-task registration, legacy evidence-receipt
protocol, marketplace or frontend code loader. Cleanup uses a short-lived generic
managed-directory reservation, not the removed managed Workflow system.

## Settings

The plugin declares schema version 1 and defaults. Pi Web stores only explicit
overrides in `~/.pi/agent/pi-web/plugins/git-workflow/settings.json` (relative to
`PI_CODING_AGENT_DIR` when configured), using owner-only directories/files and
locked atomic writes. No settings are stored in tracked repository files or the
session transcript. The version-1 document may also contain explicit overrides
bound to a session ID and its own repository.

Resolution is **built-in → global → selected project → session**, with the last
layer applying **only to the session's own repository**. The canonical physical
common Git directory identifies a repository, so linked worktrees share identity.
A foreign-repository operation uses that target's project settings without any
caller-project or session overrides. Projects and applicable sessions can replace
action permissions, target, method and checks. Enablement is
global-only: disabling prevents all new plugin execution in every project.
The panel shows the effective value and its origin beside each field. **Use
global default** deletes a project override; **Use built-in default** deletes a
global override. Session **Use project default** removes that session field.
Explicit false, null and empty check arrays are not inheritance. Saving a field
changes subsequent invocations immediately; settings do not schedule any work.
The session header's **Policy** / **Session plugin settings** shortcut opens the
existing plugin panel at session scope for the selected session's own cwd, not
the sidebar's possibly different checkout. The regular plugin panel also offers
Global / Selected project / This session scopes. Session scope is unavailable
when the selected repository is not the session's own repository.

Session overrides survive wrapper recreation, compaction and in-session branch
navigation. A moved session cannot use its old repository binding in its new
project; forks, clones and subagents do not inherit permissive overrides. Routes
resolve the saved session header themselves; tools take identity from SDK context.

### Workflow choices and presets

Working location (dedicated worktree/current branch), completion (retain/integrate),
target and method selection, worktree cleanup, local feature-branch cleanup and
generated-artifact cleanup each support **Ask via `ask_user`**. Ask means ask for
each applicable unresolved choice; it never auto-answers from a previous task.
Answers do not silently write settings. Configured target/method selection uses
the existing target/method fields; a missing target still needs a question.

**Always ask**, **Isolated, retain**, **Isolated, clean up** and **Current branch**
are explicit workflow-only recipes. Select then Apply to replace those choices in
the selected scope; permissions, check commands, target branch and merge method
are unchanged. Isolated cleanup still asks about generated artifacts by default.
Presets grant neither implementation nor remote-operation authority.

The read-only `git_policy` tool reports effective values, origins and a revision
for an explicit selected repository. Request-local `pi-web:git-policy/v1` context
refreshes on each model request, is not persisted in the transcript, and reminds
the agent to use `ask_user` for workflow Ask. Tool execution independently resolves
and rechecks policy. Applicable skills/instructions must recognize that contract
before it replaces their mandatory questions; stronger explicit constraints still
apply. A workflow question chooses intent; an exact Git approval belongs to the
tool card, not a duplicate preceding question.

`git_cleanup` adds bounded artifact/worktree/branch cleanup under a new, separate
`cleanupFeature` permission; existing `removeWorktree` remains strict and retains
branches. Both Ask and Allow operations leave durable execution cards, not just
tool results. See [ADR 0016](adr/0016-session-git-policy.md). No tool can change settings. Agents must not use shell/API access to change their own permissions.
The same authenticated host/origin boundary as other Pi Web settings applies;
this plugin is not an OS sandbox for an agent that already has shell access.

Each of `commit`, `rebase`, `merge`, `createWorktree`, `attachWorktree`,
`removeWorktree` and `cleanupFeature` has exactly one **deny / ask / allow** setting, default **ask**:

- **deny** refuses before preview or checks.
- **ask** displays the selected resources, captured full refs/tree, exact message,
  Git arguments and required check commands, then waits for an explicit answer.
  That approval covers those checks and the operation, not future invocations.
- **allow** executes without an approval question, with the same validation, except
  cleanup artifacts missing from the reusable allowlist still require one-time
  approval. Operation Allow never supplies missing artifact authority.

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
built-in → global → **selected repository**, plus session overrides only for
an operation in the session's own repository. The caller project's permissions
and recipes are never imported into a foreign-repository operation. Pending approvals follow the selected settings, and changing those
relevant settings cancels them. Global disable still stops all new plugin calls.
Related base/feature/removal checkouts must remain in the selected repository;
registration and captured physical identity/state are rechecked before effects.

- `git_commit`: `checkout`, `mode: files | staged`, exact `message`; Files also
  supplies literal whole-file paths. Files commits their full working contents,
  including unstaged edits, and preserves unrelated staging. Staged commits the
  entire index and preserves unstaged content. A native `index.lock` protects
  whole-file effects while a temporary index is reconciled by Git's `--only`;
  no destructive reset is used. Initial/unborn repositories are not supported.
- `git_policy`: read-only effective policy and origins for the explicit selected
  repository. No settings writes or Git effects.
- `git_rebase`: `checkout` of `featureBranch` onto the configured local target.
  Optional `targetBranch` supplies the answer when target selection is Ask;
  otherwise it must match a nonempty configured target. A missing configured
  target can also be supplied for one invocation without saving a setting.
  Both branches must differ. No autostash, update-refs of other branches, automatic
  merge-preserving rebase, hidden retry or conflict cleanup.
- `git_merge`: target `checkout` and `featureBranch`; uses captured local refs and
  the configured method. Optional `targetBranch` / `mergeMethod` supply invocation
  choices when the respective workflow setting is Ask, without changing settings.
  No automatic rebase, method fallback, squash, cleanup or
  remote operation. Per-branch mergeOptions cannot change the selected method.
- `git_worktree`: action `createWorktree | attachWorktree | removeWorktree`, source
  `checkout`, explicit absolute `path`; create/attach also supply `branch` and
  `baseBranch`. Create requires a new branch; attach requires that same existing
  local branch as base. Destinations are directly under `<main>-worktrees`.
  Removal never deletes a branch and refuses main/caller/source checkouts
  (including a caller cwd below that checkout's root), dirty/untracked or ignored
  content. This tool has no force removal or implicit post-merge cleanup.
- `git_cleanup`: explicit `checkout`, `featureBranch`, full `featureTip` and
  `integrationCommit`, optional invocation `targetBranch` and `worktreePath`,
  explicit `removeWorktree` / `deleteBranch` booleans and `artifactRoots` array of
  literal top-level generated files/directories. Worktree removal also proposes
  top-level ignored artifacts, even with an empty array. Listing/discovery is not
  permission; unlisted artifacts require the live approval below.
  The feature must remain exactly at its captured tip and be an ancestor of the
  pinned integration commit, which must remain reachable from the local target.
  A kept checked-out worktree cannot have its branch deleted. Symbolic refs and
  symlink-aliased cleanup checkouts are refused. Branch deletion conditionally
  deletes only that exact local ref without dereferencing; branch configuration,
  remote refs and backups remain untouched.

### Bounded cleanup

Cleanup supports two complementary ways to authorize exact generated **files or
directories** (see [ADR 0017](adr/0017-cleanup-artifact-approval.md)):

- **One-time approval:** when removing a worktree, the server proposes top-level
  ignored files/directories alongside explicitly selected `artifactRoots`. Any
  artifact missing from the reusable allowlist requires one live cleanup card,
  **even when `cleanupFeature` is Allow**. The card lists each path, counts, byte
  size and content/metadata digest, distinguishing permitted artifacts from those
  needing approval. Approve authorizes only that captured operation; Reject/Cancel
  retains the resources. It never changes settings. Missing browser UI fails closed.
- **Reusable allowlist:** **Settings → Plugins → Git Workflow → Permitted generated
  files and directories** (`approvedArtifactRoots`) accepts comma-separated literal
  top-level names, with **no defaults or globs**. For example, explicitly permit
  `.codegraph, node_modules, .next, test-results, next-env.d.ts, tsconfig.tsbuildinfo`
  for a project if those paths are disposable there. Existing directory entries
  keep their meaning. With all artifacts permitted, cleanup follows its ordinary
  Ask/Allow permission; the allowlist itself does not grant operation permission.

There is no need to populate settings merely to reach a one-time approval. An
agent can propose paths but cannot grant itself authority or modify the allowlist.
Ignored status does not mean disposable: review the displayed paths. Workflow
artifact Ask still chooses intent through `ask_user`; Keep forbids deletion, and
Deny refuses before discovery. Do not add a duplicate `ask_user` artifact-permission
question before the card. Existing `removeWorktree: allow` does not grant cleanup
permission, and strict `git_worktree` removal still refuses ignored content.

One cleanup card covers the artifacts, worktree and local branch. Under a one-time
exception its durable receipt says **User approved**, with effective Ask mode and
configured-permission provenance, not **Policy authorized**. Counts/digests are
compact rather than one record per dependency. Inventories include contents,
metadata, identities, tracked source and registration guards. Paths are frozen
before approval: later files cannot be silently included. Unselected unignored
untracked files still block; explicit generated paths may be proposed for approval.
Nested ignored files are never promoted to a parent containing tracked source.
Tracked source inside an artifact root, dirty source, nested repositories, special
files, symlink roots, mounted directories, locked/prunable worktrees and observed
active use refuse cleanup. Roots must match exact directory-entry spellings;
case/trailing-dot aliases of tracked roots or `.git` are conservatively refused
on every platform. Links inside artifact directories are inventoried as
links, never followed. Main and caller checkouts (including descendant cwds) are
protected.

Enumeration is incremental and bounded: at most 250,000 entries / 8 GiB per scan,
and 750,000 entries / 24 GiB / 90 seconds of inventory time across the invocation.
Approval waiting does not consume that time budget. Directory membership is
indexed once per scan; reads reuse a buffer and yield so Stop/settings requests
can be processed. Limits refuse rather than truncate. Linux mount metadata also
rejects same-device bind mounts; other platforms reject device changes and links.

A managed-directory reservation spans final validation and mutation, blocking new
Pi Web prompts/startup/terminals in that directory while existing active use
prevents acquisition. It is not an OS/filesystem lock: external writers remain
uncoordinated. Resources and policy are checked between effects. Stop or changes
retain the remaining resources after already-dispatched effects settle; failures
record completed steps and the last attempted step, including partial deletion.
There is no forced removal, rollback, hidden retry or backup cleanup. Target
advancement alone does not stale cleanup while the pinned integration remains
reachable; moving exact merge IDs still stales merge approval.

Effects are unsigned and hook-free, as disclosed in previews. Rebase/merge use
Git's native conflict behavior; conflict state remains for explicit human/agent
resolution. Sparse checkouts, hidden index flags and clean/process filter
attributes (including LFS) are refused: even status/preview could otherwise run
project commands before approval. Preview uses an ephemeral index and may add
unreachable Git objects, but never stages working files. The supplied rebase/merge
patch shows feature changes since the merge base, **not** a predicted result.
Approval patches use the [shared diff-review controls](worktrees.md#full-file-diff-review):
stacked collapsible files (first expanded), change types/counts, **Expand all files /
Collapse all files** and one shared split/unified/raw and wrap toolbar. Expanding
file sections never eagerly loads full context. Collapsed renderers unmount; other
expanded files render near view. Binary and metadata-only changes remain explicit;
oversized interactive diffs fall back to their complete raw file patch. The exact
supplied raw patch is always available and never reconstructed from context.
Unsupported multi-file framing falls back to it without omitting files; bounded-read
failures refuse rather than silently truncating approval data.

Current permissions, relevant settings, checkout/ref/index/file state are checked
again after approval, between checks and immediately before the native effect.
No Git lock is held while waiting for approval. External filesystem/ref writers
can still race the final checks; this is not an atomic repository snapshot or a
OS-level reservation. Cleanup's managed-directory admission guard does not exclude
external writers. Stale operations refuse only that invocation, never other sessions.
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
SSE reconnect replays pending cards; request dismissal, Stop and wrapper teardown
cancel them. Escape in **Wide view** closes only the reader and restores focus;
it neither submits nor cancels the live approval. Disable or relevant settings
changes cancel waiting Git approvals; Pi's supported dynamic registration/hidden
exposure removes active tools and their guidance immediately. Re-enable registers
them without rebuilding the session.
Native effects already started are not interrupted. Historical cards/tool results
are never execution authority, and a server restart cannot reconstruct an approval.
Settings and transcript history may remain for re-enabling.

### Durable execution receipts

Every admitted Git operation persists `pi-web:operation-receipt` snapshots before
checks/effects and at settlement. A separate generic host API owns persistence;
missing capability or failed pre-effect persistence refuses execution. Records
carry the operation UUID, optional SDK tool-call ID, exact bounded presentation,
authorization mode/source/revision, check states and observed outcome. Ask decision
receipts retain the same operation UUID but remain explicitly decision-only.
Allow says **Policy authorized**, never **User approved**.

Only the latest on-branch snapshot for an operation is displayed, collapsed and
read-only, including after reload, pagination and SSE reconnect. Host sequences
prevent stale history from replacing newer results. These are custom data entries,
not model-context messages or replayable tool calls. No history is backfilled.
Unfinished stages say **outcome unknown**; an executing-intent marker does not prove
an effect started or completed. A failed terminal write is reported in the tool
result without pretending the Git mutation was rolled back. Native partial effects
and check failures remain explicit. SDK HTML export does not render these cards.

### Optional full-file patch context

New Git patch approvals may carry an optional opaque UUID handle in the plugin's
namespace. Commit snapshots bind captured **HEAD / candidate index tree** IDs;
rebase/merge snapshots bind **merge-base / feature commit** IDs. They supplement
the exact supplied patch, never replace or reconstruct it. The in-memory registry
stores comparison/file identifiers, not file contents, with a **one-hour TTL,
64 handles and at most 256 files per handle**. Reads recheck the physical common
Git-directory identity before reading those objects.

Core's generic **GET `/api/plugins/bundled/[id]/patch-context`** accepts only
`handle` and a numeric `file` ID (0–255). The plugin resolves the captured file;
there are no arbitrary paths or Git revisions, new previews, checks or mutations
in this read. The shared **1 MiB per side / 50,000 combined lines per file** limits
and [text/object rejection rules](worktrees.md#full-file-diff-review) apply; failed
context leaves the patch readable.

Historical receipts may read the same handle while retained. Legacy cards,
expiry, eviction, server restart or unavailable objects remain patch-only; there
is no durable content backfill or substitution from current working files.
Context availability does not extend an approval's lifetime or execution authority.

## Verification

Core tests remain separate from expensive Git integration tests. See
[Testing](testing.md) and [browser fixture notes](../e2e/README.md). From a prepared
Linux worktree, with no dev server owning that checkout:

```sh
nix develop --offline --no-write-lock-file -c node nix/test-offline.mjs
# Separate plugin tests: snapshot bounds/expiry + real Pi registration/toggle lifecycle.
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
