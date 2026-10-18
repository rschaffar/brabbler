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

Current policy is projected after the earliest user message or compacted/branch
summary, not appended after each new tool result. The stable request-only anchor
preserves reusable prompt prefixes and WebSocket delta continuation while settings
remain unchanged. The full-transcript SDK hook preserves existing system/tool
anchors; policy changes refresh the projected block immediately and may legitimately
invalidate its cached suffix. No snapshot becomes execution authority or persists
in conversation history.

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

The browser manager additionally declares `discardResources` (**Manual manager
discard**, browser only), default Ask. It has no agent tool: Deny refuses, while
Ask **and Allow** require the exact live browser confirmation. Its resolution omits
session overrides. Agent `cleanupFeature` remains integrated-only; manual discard
does not inherit completed-feature Keep choices, but cannot waive source, target,
activity or artifact protections.

Target local branch defaults to null (choose one before rebase/merge). Merge
method defaults to ordinary non-FF; FF-only is the other choice. Required commit
and merge checks are named shell commands, default empty arrays. Edit them as JSON,
for example `[{"name":"Tests","command":"npm test"}]`. Commands run with a
sanitized Git environment and drain their full output while retaining a bounded
display tail. There is no implicit deadline. Optional `timeoutMs` sets an explicit
per-check deadline; omitted or zero means none. Stop/deadline terminates cancellable
check processes, with escalation and honest reporting of uncertain settlement.
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
  literal worktree-relative generated files/directories, including nested paths
  using `/` (for example `src/meetings/__pycache__`). Worktree removal also proposes
  exact ignored artifacts at any depth, even with an empty array. Listing/discovery is not
  permission; unlisted artifacts require the live approval below.
  The feature must remain exactly at its captured tip and be an ancestor of the
  pinned integration commit, which must remain reachable from the local target.
  A kept checked-out worktree cannot have its branch deleted. Symbolic refs and
  symlink-aliased cleanup checkouts are refused. Branch deletion conditionally
  deletes only that exact local ref without dereferencing; branch configuration,
  remote refs and backups remain untouched.

### Bounded cleanup

Cleanup supports two complementary ways to authorize exact generated **files or
directories** (see [ADR 0017](adr/0017-cleanup-artifact-approval.md) and its
[nested-path revision, ADR 0019](adr/0019-nested-cleanup-artifacts.md)):

- **One-time approval:** when removing a worktree, the server proposes exact
  ignored files/directories, including nested artifacts, alongside explicitly selected `artifactRoots`. Any
  artifact missing from the reusable allowlist requires one live cleanup card,
  **even when `cleanupFeature` is Allow**. The card lists each path, counts, byte
  size and content/metadata digest, distinguishing permitted artifacts from those
  needing approval. Approve authorizes only that captured operation; Reject/Cancel
  retains the resources. It never changes settings. Missing browser UI fails closed.
- **Reusable allowlist:** **Settings → Plugins → Git Workflow → Permitted generated
  files and directories** (`approvedArtifactRoots`) accepts comma-separated literal
  worktree-relative paths, with **no defaults or globs**. For example, explicitly permit
  `.codegraph, node_modules, next-env.d.ts, src/meetings/__pycache__`
  for a project if those paths are disposable there. Existing top-level entries
  keep their meaning. Authority matches an exact selected root: permitting `src`
  does not permit a separately selected `src/meetings/__pycache__`. With all artifacts permitted, cleanup follows its ordinary
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
Nested ignored paths are never promoted to a parent containing tracked source.
Explicit roots must be distinct and nonoverlapping; when Git reports a wholly
ignored directory containing an explicitly selected child, the approval lists
that exact ignored directory once. Every slash-delimited component must be literal:
absolute paths, traversal, empty components and backslashes are refused.
Tracked source inside an artifact root, dirty source, nested repositories, special
files, symlink roots or ancestors, mounted directories, locked/prunable worktrees
and observed active use refuse cleanup. Every component must match an exact
directory-entry spelling; case/trailing-dot aliases of tracked paths or `.git`
are conservatively refused on every platform. Sharing an exact tracked directory
parent is allowed, but does not authorize deleting it or its other children.
Artifact-only cleanup retains empty structural parent directories. Nested deletion
requires Linux `/proc/self/fd` and no-follow directory opens: captured ancestor
handles stay open across each deletion, preventing a later ancestor symlink swap
from redirecting it. Unsupported platforms/proc configurations refuse nested
cleanup before approval; top-level cleanup is unchanged. Explicit child paths are
validated even if discovery later proposes their wholly ignored parent. Links inside artifact directories are inventoried as
links, never followed. Main and caller checkouts (including descendant cwds) are
protected.

Enumeration is incremental, complete and cancellable, without fixed root-count,
entry/byte or cumulative time ceilings. Content reads reuse a buffer and yield;
large directory sorting spills to private scratch instead of retaining every name
in one sort buffer. Source-name indexes and explicit resource metadata still scale
with their counts. Progress reports distinguish inventory work from authorization.
Source contents, entry structure and identities remain frozen across deletions.
Direct artifact-parent size/timestamps are also strict through approval and before
the first effect; only a completed child deletion permits those volatile fields
to differ for its own direct parent. Unaffected ancestor directories and all
remaining artifacts retain strict metadata checks. Each inventory still requires
metadata stability within that scan. No incomplete inventory authorizes deletion.
Real I/O/storage failures refuse;
Linux mount metadata also rejects same-device bind mounts, while other platforms
reject device changes and links.

A managed-directory reservation spans final validation and mutation, blocking new
Pi Web prompts/startup/terminals in that directory while existing active use
prevents acquisition. It is not an OS/filesystem lock: external writers remain
uncoordinated. Resources and policy are checked between effects. Stop or changes
retain the remaining resources after already-dispatched effects settle; failures
record completed steps and the last attempted step, including partial deletion.
There is no forced removal, rollback, hidden retry or backup cleanup. Target
advancement alone does not stale cleanup while the pinned integration remains
reachable; moving exact merge IDs still stales merge approval.

Checkout validation resolves the six per-worktree operation-marker paths in one
Git invocation, then checks every marker afresh. `operation-paths.ts` validates
the complete response framing without splitting legal embedded POSIX newlines;
unusual output/layouts fall back to individual successful path resolutions.
Command errors still propagate. This batches path lookup only: policy, refs,
registration, source/filter/index state, inventories and no-follow/mount checks
remain fresh at their existing checkpoints, without cross-stage caching.

Effects are unsigned and hook-free, as disclosed in previews. Rebase/merge use
Git's native conflict behavior; conflict state remains for explicit human/agent
resolution. Sparse checkouts, hidden index flags and clean/process filter
attributes (including LFS) are refused: even status/preview could otherwise run
project commands before approval. Preview uses an ephemeral index and may add
unreachable Git objects, but never stages working files. The supplied rebase/merge
patch shows feature changes since the merge base, **not** a predicted result.
Exact review material is saved once before the prepared receipt, independently of
card size. Small reviews use the [shared diff-review controls](worktrees.md#full-file-diff-review):
stacked collapsible files (first expanded), shared split/unified/raw and wrap,
optional full context and read-only historical review. Larger reviews use 40-entry
inventory pages and lazy entry reads. Interactive rendering is display-bounded;
large individual entries have 256 KiB raw content pages. Complete exact reviews,
raw patches and individual entries can always be streamed for download while the
saved material is available. Binary and metadata-only changes remain explicit.
Preview errors leave the operation card and action footer available. A page,
excerpt or expanded file never narrows the captured operation's approval scope.
No raw patch is reconstructed from context or silently dropped to fit a card.

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
carry the operation UUID, optional SDK tool-call ID, compact bounded presentation
and an immutable exact-review reference, authorization mode/source/revision,
check states and observed outcome. Patches are not duplicated at every stage. Ask decision
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

### Durable exact review storage

Generic session-scoped GET `/api/sessions/[id]/reviews/[reviewId]` validates the
exact reference in persisted operation/interaction receipts, including prepared
operations. It never creates wrappers, reads a checkout or grants permission.
The existing application authentication/origin boundary applies. Reads validate
stored integrity; bounded pages and streamed downloads do not impose an operation
size ceiling. Old inline receipts continue to render unchanged.

Private `pi-web/reviews/` storage is independent of cwd and creator-session paths.
Moves preserve references; forks with copied receipts retain access even after
the parent is deleted. Published bundles have no TTL or automatic garbage
collection, including bundles orphaned after publication. Unpublished scratch is
removed by its writer. Back up this directory along with session JSONL for full
review history; do not delete it during rollback. Insufficient disk space or
failed pre-effect persistence still refuses execution. See
[ADR 0018](adr/0018-size-independent-git-reviews.md).

### Optional full-file patch context

Small new Git patch approvals may carry an optional opaque UUID handle in the plugin's
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

## Standalone project removal API

The no-chat manager uses the shared resource capture/effect engine through a bounded
generic project-action host (`lib/plugins/project-operations.ts`), not a bare deletion
endpoint or fabricated session. Global/project policy applies, never session overrides.
The browser-only `discardResources` adapter permits any containment state, including
Unknown/no target, and valid clean detached worktrees. The legacy `cleanup` action and
agent `git_cleanup` remain integrated-only. The public agent executor rejects discard.

Browser preparation **always waits for manual confirmation**, including configured
Allow with no artifacts or entirely permitted artifacts. Its receipt says User approved
with configured-policy provenance; tool Ask/Allow behavior is unchanged. Manual discard
bypasses completed-feature cleanup Keep preferences, never operation Deny or artifact
authority. Both configured and temporary comparison targets remain protected; a missing
configured target is allowed, an existing symbolic configured target is refused.
Unignored untracked files block browser removal; explicit artifact roots are not accepted.
Exact ignored discovery, one-time artifact consent, main/invocation/selected/active
protections, reservations and partial results reuse the executor. Idle chats warn only.

The plugin computes loss evidence from the frozen review, not client flags. Deleting a
branch not proven integrated supplies `requiredAcknowledgment`; retaining a branch or
removing a detached worktree does not fabricate branch-loss consent. Detached removal
warns that commit retention is not guaranteed. Originally proven branch deletion fails
closed on proof/ref-binding loss. Git 2.34+ prepared ref transactions bind the current
direct comparison tip and exact subject deletion; direct-ref, designation, graph,
registration and policy checks repeat before committing while those ref locks are held.
Other external filesystem/checkout writers remain uncoordinated.

- GET `/api/worktrees/manage?cwd=…&target=…` captures the whole lightweight local
  branch/registration inventory. No target is necessary to list resources. The
  default comes from effective project/global `targetBranch`, never session policy.
- GET the same route with `captureId`, `details=1` and `rows` (JSON array of up to
  50 captured row IDs) loads narrow status and graph-date evidence. Handles expire
  after 15 minutes/restart; moved refs/registrations require refresh (409). Client
  filtering/sorting covers the whole capture; date sorting must settle all matching
  rows first. Reads are local-only and bounded, not cleanup authorization.
- POST `/api/plugins/bundled/[id]/project-actions` with `{cwd, requestId, action,
  payload}` starts preparation and returns 202 immediately. Git's `action` is
  `remove`; payload contains `subject: {kind: "branch", branch, tip}` or
  `{kind: "detached", head}`, `removeWorktree`, `deleteBranch`, optional `worktreePath`,
  and optional `comparisonTarget: {branch, tip}`. IDs are full captured commit IDs.
  Detached subjects permit only worktree removal. No acknowledgment flag or artifact
  root is accepted during preparation. Legacy `cleanup` retains exact `featureBranch`,
  `featureTip`, `integrationCommit`, `targetBranch` and resource choices.
- GET that collection with `cwd` lists the latest 50 saved outcomes. GET
  `/project-actions/[operationId]` polls one operation; only its live `card` at
  `state: review` is actionable. `receipt.card` is historical/read-only.
- POST the operation URL with `{cwd, decision: approve | reject | stop}` claims a
  single decision. For a requirement-bearing live card, approval additionally needs
  `acknowledgment: {cardDigest, accepted: true}` matching the server status descriptor.
  Missing, false, stale or foreign consent refuses without releasing authority;
  approval retries must repeat that exact envelope. Reject/Stop never carry it.
  The host freezes the complete card with a fresh operation-bound nonce; replacement
  cards get fresh digest identities even if their contents match. Accepted metadata
  is durable with the decision before authority is released. Legacy cards need no
  envelope. Unsupported requirement-bearing session cards fail closed, not silently
  approved through their older transport.
  The invocation checkout must remain the selected one. Matching decisions/prepare
  UUIDs do not replay effects; conflicting input refuses. Stop remains available after
  approval while awaiting outcome and prevents only undispatched steps. Saved consent
  is read-only evidence; restart cannot recover live authority.
- Status supplies `reviewBaseUrl`: operation-bound `/reviews/[reviewId]`, with the
  existing `start`, `entry`, `offset`, `download` and `patch` query protocol. No
  session ID is needed. Saved ownership and allowed surviving project access
  authorize historical reads even when the plugin is disabled or a feature
  checkout is gone; integrity checks still apply.

An operation owns preparation/confirmation/effect lifetime independently of HTTP
requests. Closing pending review explicitly sends Stop; transport loss alone
cannot distinguish a lost response from abandonment. Live reviews expire after
15 minutes. Process-wide authority survives HMR, but persisted unfinished records
are outcome-unknown after restart and cannot execute. Private owner-only records
and exact reviews are retained without an automatic reaper. Durable pre-effect
writes fail closed; failed final writes never imply rollback or settlement.
See [ADR 0021](adr/0021-standalone-project-cleanup.md) and its
[browser discard revision, ADR 0022](adr/0022-browser-resource-discard.md),
`lib/worktree-management-types.ts` and `lib/plugins/project-operation-types.ts`.

## Verification

Bundled plugin Node tests, including real Pi registration/toggle lifecycle and
snapshot expiry/bounds, participate in the sandboxed core inventory. Full sandboxed
browser acceptance includes the explicit `git-plugin` and `session-launch` groups. See
[Testing](testing.md) and [browser fixture notes](../e2e/README.md):

```sh
nix flake check -L
# Fresh focused iteration, not full acceptance:
nix run .#test -- core --file plugins/git-workflow/cleanup.test.mjs
nix run .#test -- e2e --group git-plugin
```

CI freshly executes the same complete core, sandboxed browser and genuine deployment definitions.
No separate npm environment, plugin-only CI matrix or development-server path is
required. Nix realizes dependencies and builds the actual package in isolation;
the restricted guest uses synthetic providers, not real accounts or model calls.
Implementation/verification do not authorize integration, publication, deployment
or feature-resource cleanup.
