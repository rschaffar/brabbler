# Contributing to Brabbler

This is an independently maintained personal project, not an official Pi Web
release. Discuss material changes before investing in a large contribution.
[Architecture](docs/architecture.md) maps the implementation;
[testing](docs/testing.md) owns verification and resources.

## Local workflow

1. Start from current **local main**, on a dedicated feature branch in a linked
   worktree. Keep the primary checkout for reviewed integration, not feature edits.
   Preserve existing work; never stash/reset/clean unrelated state for convenience.
2. Read the relevant focused guide listed in [AGENTS.md](AGENTS.md). For substantial
   work, use the repository's [planning skill](.agents/skills/writing-plans/SKILL.md).
   A plan is not authority to execute or publish it.
3. Make reviewable commits and run focused Nix checks while editing. Build the
   production application only in isolated Nix builders, never a working checkout.
   Do not replace managed dependencies with another checkout's directory.
4. After source/review changes settle, run complete core/static/plugin,
   browser/terminal and genuine Home Manager VM acceptance. Portable-archive changes
   also need the additional ordinary-runtime smoke evidence. Record exact inputs,
   selections, outcomes and diagnostics; a focused pass is not full acceptance.
5. Rebase the feature onto current local main and review the exact resulting
   candidate before an ordinary unsigned **non-fast-forward** local merge. Preserve
   feature resources if blocked; cleanup is a separate decision.

Agent users with the global `git-worktrees` skill follow its detailed approval,
operation-receipt and cleanup lifecycle in addition to these repository rules.
Human contributors need not install that private/global skill to understand the
repository's isolation, checks or required local integration method above.

Sending a pull request from an owned fork is separate from local integration;
maintainers review it under this repository's workflow. No agent may infer
permission to push, create a repository, dispatch CI, change remote settings,
publish a release or remove worktrees from an implementation request.

## Public-safe contributions

Treat tracked files, plans, commit messages and images as public. Use synthetic
sessions and neutral example paths/hosts. Keep private investigation evidence
outside Git; review text, screenshots and metadata before staging. Deleting a
private detail in a later commit does not remove it from history. Preserve original
licenses/attribution; deliberately public author/contact information is not a secret.

Report security concerns via [the private-reporting policy](SECURITY.md), not an
unredacted public issue. Do not post credentials, private transcripts or customer
code to demonstrate a bug.
