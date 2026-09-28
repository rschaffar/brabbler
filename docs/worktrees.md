# Worktrees in Pi Web

Pi Web can show all Git worktrees for one project in the sidebar. Use this when you want to keep separate checkouts for different branches, while keeping the project's sessions grouped together. For per-chat preferences, checkout continuation, commit preview and read-only integration review, see [Session Git workflow](./git-workflow.md).

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

### Browse the selected worktree's Git history

Open the **Git Explorer** icon beside Activity and Starred. Its wide panel places the graph to the left of commit details and file diffs, alongside the chat; on mobile select a commit to see its details and use **Back to commits** to return to the graph. It follows the checkout selected by the sidebar worktree switcher, even when a chat from another checkout remains open, and needs no open chat or workflow policy. By default it shows that checkout's branch. The **History branch** selector can browse any local branch in the same repository without checking it out. Its read-only graph shows commits reachable from the selected branch's captured tip in topological order, with merge lanes, local branch labels and older-history pages. Select a commit to inspect its author, message and changed files next to the graph; copy its full message or ID with the separate hover/focus buttons. Select a file to see committed changes **side by side**, with old/new line numbers, hunk boundaries and a switch to unified or raw patch. The comparison is against the commit's first parent (or the empty tree for a root commit). Narrow phone screens can scroll diff columns horizontally. **Refresh** captures the current tip of the selected branch. If that branch moves or disappears while browsing, refresh before loading more history or inspecting a commit. Binary files get a summary; oversized patches fail rather than showing partial output. Detached HEAD and non-root directories cannot be browsed. This does not read uncommitted files, run checks, switch branches, merge, or contact remotes. Session-bound **Local integration review** is a separate workflow.

The graph layout adapts [binaryplease/git-graph](https://github.com/binaryplease/git-graph) under the MIT license (`lib/git-graph-layout.LICENSE`); Pi Web runs its own bounded read API and does not depend on that project's server.

## Creating a Worktree

Choose `New worktree...` from the worktree menu. **Select a local base branch** and review its full expected HEAD commit ID, then choose **Create new branch** and enter a new branch name. There is no default base: existing switcher users must make a selection before creating. The base and expected commit are checked again on the server; if the branch moved, refresh the switcher and select it again. Pi Web does not fetch or select remote-tracking refs automatically. Saving a session's worktree preference does not create a checkout; creation is a separate explicit sidebar action.

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

To check out an **existing local branch**, explicitly choose **Attach existing local branch** and select it. Its full expected tip is captured and checked before checkout; an already checked-out branch cannot be attached twice. Creating a new branch never reuses an existing one, even when a remote-tracking branch has the same name. Creation uses exactly the selected local base commit, not the current checkout HEAD. Branch names are validated by Git. The source checkout and any checkout of the selected base must be clean, including untracked files; commit, stash, or remove those changes first. Existing destination directories and stale branch tips are rejected. Concurrent external Git writers can still race the checks; retry after inspecting the repository if Git reports a conflict.

## Removing a Worktree

Use the remove button next to a non-main worktree, then explicitly confirm its removal. Integration never removes a worktree for you. This separate confirmation applies even when the checkout is clean.

Removing a worktree does not delete:

- The Git branch.
- Pi Web session history.
- The main checkout.

If the worktree has uncommitted or untracked files, Git refuses the removal. Pi Web then offers a force remove action. Force removal discards the uncommitted files in that checkout, so use it only when you no longer need those changes.

## Sessions and Worktrees

Pi Web groups sessions by project root, so sessions from the main checkout and linked worktrees appear together.

Each session still remembers the working directory it was created with. That means:

- A session started in a worktree continues to use that worktree path.
- A session started in the main checkout continues to use the main checkout.
- If a worktree has been removed, old sessions from it stay visible under the project so you can still find the history.

### Continue or fork in a registered worktree

For an idle, persisted ordinary chat at a registered checkout root, open the **Workspace workflow** icon beside Activity. Its side panel shows the chat's actual cwd, not just the checkout selected in the sidebar. Choose another registered checkout from **Destination worktree**, then explicitly confirm **Continue here…** to move the same chat/session family there, or **Fork chat here…** to keep the original and put a new chat there (fork requires an assistant leaf). Saving `onCreate` or using the sidebar's worktree-creation control never moves a chat. Separately, a persisted worktree-policy chat can let the agent explicitly invoke `git_workspace_start`; only **that agent-created** worktree can trigger its recorded automatic continue/fork once after the run settles. Neither manual continuation action creates a worktree. The changed-file warning is informational: **uncommitted files stay in the source checkout** and are not copied, stashed or reset. Stop a running chat first. If a fork succeeds but relocation fails, the fork remains and its ID is reported for inspection; never repeat the automatic attempt blindly. See [Session Git workflow](./git-workflow.md) for policy, commit and integration limitations.

Windows portability for this workflow is currently **unverified**.

## Troubleshooting

**I do not see the worktree switcher.**
Select a Git repository root. Non-Git directories and repo subdirectories show a small hint instead of the switcher.

**A branch cannot be added as a worktree.**
Git allows a branch to be checked out in only one worktree at a time. Switch to the existing worktree for that branch, or remove it first. If a base or attach tip changed since you selected it, refresh the worktree menu and select the branch again.

**A removed worktree still shows up in Git.**
Git can keep prunable worktree records after a checkout disappears. Pi Web filters those out of the switcher.

**The Explorer shows a different branch than the open chat.**
The Explorer follows the selected worktree. The chat follows the opened session. Click the session again to move the sidebar back to that session's checkout.
