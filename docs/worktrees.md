# Worktrees in Pi Web

Pi Web can show all Git worktrees for one project in the sidebar. Use this when you want to keep separate checkouts for different branches, while keeping the project's sessions grouped together.

## When the Worktree Control Appears

The worktree switcher appears below the project picker when the selected directory is a Git repository root.

It is hidden when:

- The selected directory is not a Git repository.
- The selected directory is inside a repository, but not the repository root.
- Git cannot read the repository's worktree list.

If you are inside a repo subdirectory, open the repository root from the project picker to manage worktrees.

## Switching Worktrees

Use the worktree switcher to choose which checkout Pi Web should use for new work in that project. A merge-branch icon beside a linked checkout (and its selected label) means its current branch tip is contained in local `rst-main`; it does not indicate whether the checkout has uncommitted changes. The selected-checkout checkmark is separate. The badge is omitted when `rst-main` is unavailable, and updates when the switcher reloads.

Switching worktrees affects:

- New sessions started from the sidebar.
- The File Explorer and Git Explorer.
- File mentions inserted from the File Explorer.

Existing sessions stay grouped under the same project. Opening an existing session moves the effective working directory back to that session's checkout.

### Trusting project resources

A new worktree is **not** trusted merely because an agent or the sidebar created it. When project extensions, skills or settings require trust, Pi Web keeps them restricted and offers **Review trust…** for the selected chat's checkout. Choose **Trust this worktree only** to trust just that checkout (the Pi CLI shares this path decision), or **Trust this Git project (all worktrees)** to trust every registered checkout of the same repository, including future worktrees. The broader decision is Pi Web-only; it does not automatically trust those paths in the Pi CLI. Trust enables project-controlled resources that may run local code, not Git mutation permissions or general file access.

**Settings → General → Manage trust…** shows the current effective decision even when no resources need trust yet. Stop trusting a worktree to restrict it even under a project grant; clear that override to return to the project's decision. Stopping project-wide trust leaves explicitly trusted worktrees trusted. Changing trust while affected sessions are active is refused; try again once they finish. An unregistered checkout or another repository never inherits a Git project grant.

### Browse the selected worktree's Git history

Open the **Git Explorer** icon beside Activity and Starred. Its wide panel places the graph to the left of commit details and file diffs, alongside the chat; on mobile select a commit to see its details and use **Back to commits** to return to the graph. It follows the checkout selected by the sidebar worktree switcher, even when a chat from another checkout remains open, and needs no open chat. By default it shows that checkout's branch. The **History branch** selector can browse any local branch in the same repository without checking it out. Its read-only graph shows commits reachable from the selected branch's captured tip in topological order, with merge lanes, local branch labels, distinguishable local **tag** labels and older-history pages. Lightweight and annotated tags label their commits; tags do not become branch-selector options or authorize browsing unrelated objects. No tags are fetched or created by the explorer. Select a commit to inspect its author, message and changed files next to the graph; copy its full message or ID with the separate hover/focus buttons.

Changed files appear as stacked collapsible diffs, with the first file expanded.
**Expand all files / Collapse all files** open or close file sections, never eagerly
load full-file context. One shared sticky toolbar selects **Side by side**, **Unified**
or **Raw patch** and wrapping. Committed patches load lazily, at most three requests
at once, with per-file loading/error/retry state and caching for that captured commit
view only. Collapsed renderers unmount; other expanded files defer loading/rendering
until scrolled near. Changing commit, branch or checkout cancels old reads.

Patches and full context compare immutable commit objects against the commit's
**first parent** (or the empty tree for a root commit), revalidating the captured
local branch tip after context reads too. **Refresh** captures the branch's current
tip; refresh if it moves or disappears. Binary files get a summary; oversized
patches fail rather than showing partial output. Detached HEAD and non-root
directories cannot be browsed. Explorer never reads uncommitted files, runs checks,
switches branches, merges or contacts remotes.

The graph layout adapts [binaryplease/git-graph](https://github.com/binaryplease/git-graph) under the MIT license (`lib/git-graph-layout.LICENSE`); Pi Web runs its own bounded read API and does not depend on that project's server.

#### Full-file diff review

Explorer, Files-panel and Git approval/receipt diffs share virtualized Pierre
`CodeView` rendering (`@pierre/diffs` stays at 1.5.1):

- **Show full file / Diff context** reveal or hide full context for one file in
  split or unified view. Tab to gap buttons and press Enter/Space to reveal nearby
  lines incrementally or the **entire gap**. Context loads only when requested.
- **Previous/Next change** navigate changes. **Before / After** show clean file
  versions; **Changes** returns to the diff. A missing side is explicitly absent,
  not an empty file.
- Search is **literal and case-insensitive**, not regex. Search and **Go to line**
  use the **Before/After (old/new)** side selector in Changes view, or the displayed
  clean version, revealing omitted lines as needed without changing the comparison.
- Turn **Wrap lines** off for horizontal scrolling. **Wide view** opens a larger
  reader; Escape closes it and restores focus without answering a live approval.

Parsed patches, loaded context, gap/full-file expansion, selected version and
reading anchors stay in local memory across file collapse and layout changes,
scoped to the exact commit view, approval card or working-file revision. Only
split/unified/raw and wrap preferences use browser `localStorage`, best effort;
contents and context choices are never persisted there.

Full context is limited to **1 MiB on each side** and **50,000 combined lines per
file**. Invalid UTF-8, NUL/binary content, symlinks, gitlinks, missing objects and
oversized files refuse context while leaving the patch available. Complete versions
must match the supplied hunks and omitted unchanged ranges; incompatible file
transformations cannot silently introduce changes into the displayed context. Git approval
snapshots and historical availability have [separate limits](git-workflow-plugin.md#optional-full-file-patch-context).

Files-panel diffs instead compare HEAD with the working file. Context uses the
revision returned with that patch and refuses a changed HEAD or file: refresh the
diff rather than attaching newer contents (use **Refresh diff** on a context error).
The in-memory working-revision registry
retains at most **512 entries for one hour**; expiry, eviction or server restart
requires a fresh diff.

## Managing accumulated branches and worktrees

Choose **Manage branches & worktrees…** from the worktree menu. The project-scoped
modal works without an open chat or enabled Git Workflow plugin. Opening it does
not switch checkout, relocate chats, or change settings. It lists every local
branch (including **No worktree**) and registered detached, locked, missing or
prunable worktrees. Diagnostic registrations are read-only here.

**Integration target** defaults to the existing built-in/global/project Git
Workflow target setting, never a chat's session override. Without an available
target, inventory still works; choose a literal local branch to assess containment.
Alternatives are **Temporary comparison — not saved**. **Open project target
setting** opens the existing project-scoped field. A temporary comparison does not
override cleanup policy: the manager shows a configured-target mismatch immediately.

The default order is integrated entries first, oldest tip commits first within
each group. Search, integration/checkout filters and sorting cover the entire
capture, with 50 rows per page. Status and merge evidence load progressively;
merge-date sorting loads all matching dates before reordering. Target/checkout
changes cancel old reads and invalidate live proposals. Refresh if captured refs
or registrations move.

### Reading integration and dates

**Integrated** means the captured current tip is contained in the captured target;
it does not mean files are equivalent or safe to discard. Squash/cherry-pick
integration is not inferred. A proven path establishes containment even in shallow
history; a shallow negative is **Unknown**, not Not integrated.

- **Latest tip commit** is the tip's recorded committer date, not branch activity,
  filesystem modification time, or the greatest ancestor date. Full timestamps,
  timezone, author date, subject and captured IDs appear in expanded evidence.
- **Merge commit date** is the recorded committer date of a merge introducing the
  tip along the captured target's first-parent graph. It is **not** when the target
  ref received it: fast-forwarding onto an existing merge or rewriting history can
  change that interpretation. Ordinary/root introductions have no recoverable
  merge date. Missing/shallow objects and the 10,000-commit traversal budget produce
  explicit unavailable reasons. Date availability is not cleanup authority.

### Explicit cleanup and recovery

Browsing works with Git Workflow disabled. Cleanup is owned by the optional plugin
and its effective project/global policy. Enablement applies to all projects. Choose
**Remove worktree; keep branch**, **Delete local branch** (only when unchecked out),
or **Remove worktree and delete local branch**, then **Review cleanup…**.
Preparation has no deletion effects under either Ask or Allow. Inspect the exact
resources, captured proof and ignored content before explicitly confirming; unlisted
ignored artifacts need one-time consent in that same review. No settings are saved
by confirmation, and there is no force-removal fallback.

Main, target and selected resources are protected; running/starting agents and
active terminals block removal. An explicit **Select main checkout** action moves
only the sidebar selection. Idle chats warn but do not block: history stays, while
continuing from a removed working folder may require moving the chat. Nothing
relocates or deletes chats automatically. Unignored untracked files block cleanup;
expanded checkout state shows their paths for manual resolution.

Closing/Escape stops pending preparation/review. After dispatch, Stop prevents
remaining steps, never undoes effects already started. Outcomes and exact reviews
are operation-owned and remain accessible under **Recorded project operations**
after rows disappear, reload, or plugin disablement. Recover a lost preparation
response with the same request; do not create another operation. Failed/partial or
restart-unknown results require **Refresh actual state** and inspection, not replay.
Reservations exclude observed managed activity in this server, not external writers
or other server processes.

The existing individual removal controls below keep their separate behavior;
they are not the manager's integrated cleanup path.

## Creating a Worktree

Choose `New worktree...` from the worktree menu. **Select a local base branch** and review its full expected HEAD commit ID, then choose **Create new branch** and enter a new branch name. There is no default base: existing switcher users must make a selection before creating. The base and expected commit are checked again on the server; if the branch moved, refresh the switcher and select it again. Pi Web does not fetch or select remote-tracking refs automatically. Creation is explicit and never moves or forks a chat.

Pi Web creates the checkout at:

```text
<repo>-worktrees/<branch>
```

For example, if the main checkout is:

```text
/Users/alex/Documents/Workspace/pi-web
```

and you create branch `codex/worktree-help`, the worktree is created under:

```text
/Users/alex/Documents/Workspace/pi-web-worktrees/codex-worktree-help
```

To check out an **existing local branch**, explicitly choose **Attach existing local branch** and select it. Its full expected tip is captured and checked before checkout; an already checked-out branch cannot be attached twice. Creating a new branch never reuses an existing one, even when a remote-tracking branch has the same name. Creation uses exactly the selected local base commit, not the current checkout HEAD. Branch names are validated by Git. The source checkout and any checkout of the selected base must be clean, including untracked files; commit, stash, or remove those changes first. Existing destination directories and stale branch tips are rejected. Concurrent external Git writers can still race the checks. Inspect actual state and any partial effects if Git reports a conflict; no automatic retry or rollback is implied.

## Removing a Worktree

Use the remove button next to a non-main worktree, then explicitly confirm its removal. Integration never removes a worktree for you. This separate confirmation applies even when the checkout is clean.

This manual sidebar removal does not delete:

- The Git branch.
- Pi Web session history.
- The main checkout.

If the worktree has uncommitted or untracked files, Git refuses the removal. Pi Web then offers a force remove action. Force removal discards the uncommitted files in that checkout, so use it only when you no longer need those changes.

You are responsible for not deleting a worktree still needed by a chat or terminal. No chat is moved automatically to make removal possible.

## Sessions and Worktrees

Pi Web groups sessions by project root, so sessions from the main checkout and linked worktrees appear together.

Each session still remembers the working directory it was created with. That means:

- A session started in a worktree continues to use that worktree path.
- A session started in the main checkout continues to use the main checkout.
- If a worktree has been removed, old sessions from it stay visible under the project so you can still find the history.

Use the session row’s **Move to project…** action for explicit relocation. Choose a **Destination project**, then a **Worktree/directory** showing its branch and path. The current project remains available for moves between its registered checkouts; only the exact current directory is disabled. Projects without worktrees offer their directory directly, and **Browse another folder…** accepts another existing directory, including non-Git directories. Selection only proposes a destination: it does not switch the sidebar checkout or relocate anything until you press **Move**.

Stop running sessions first. This moves the session and its subagents, not checkout files; independent forks remain in place with repaired parent references.

## Troubleshooting

**I do not see the worktree switcher.**
Select a Git repository root. Non-Git directories and repo subdirectories show a small hint instead of the switcher.

**A branch cannot be added as a worktree.**
Git allows a branch to be checked out in only one worktree at a time. Switch to the existing worktree for that branch, or remove it first. If a base or attach tip changed since you selected it, refresh the worktree menu and select the branch again.

**A removed worktree still shows up in Git.**
Git can keep prunable worktree records after a checkout disappears. Pi Web filters those out of the switcher.

**The Explorer shows a different branch than the open chat.**
The Explorer follows the selected worktree. The chat follows the opened session. Click the session again to move the sidebar back to that session's checkout.
