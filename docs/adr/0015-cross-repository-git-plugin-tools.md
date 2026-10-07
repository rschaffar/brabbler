# ADR 0015: Explicit cross-repository Git plugin tools

- Status: Accepted by user request
- Scope: Optional bundled Git Workflow plugin only; ADR 0014 remains in force

## Decision

A coding session may invoke `git_commit`, `git_rebase`, `git_merge` and every
`git_worktree` action against an explicitly selected checkout in any local
repository, including from a non-Git session cwd. The session remains the caller
and approval owner, not the operation's repository boundary.

Validate the selected physical checkout root against its own Git registration.
Resolve permissions, target branch, merge method and checks through built-in →
global → selected-repository settings; never borrow the caller project's settings.
Related worktrees stay in the selected repository. Global enablement, stronger
user/repository instructions, exact approval/state/settings revalidation, native
Git locks and honest failure reporting remain unchanged. Removal still refuses
the main, source and caller checkout, including a caller in a subdirectory.

## Consequences

No session move, task adoption, caller-repository setup or permission migration is
needed. Tool descriptions and approvals identify the actual selected checkout.
This is not a new filesystem sandbox or a grant to change permissions: selected
Deny/Ask/Allow remains authoritative, file-browser allow-lists remain separate,
and no remote operation or force removal is added. The removed managed Workflow
and private legacy data remain untouched.

Source verification and local integration do not rebuild/activate the installed
service, publish changes or authorize feature-resource cleanup.
