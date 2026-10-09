# Git project and worktree trust scopes

## Goal

Replace automatic trust inheritance for agent-created worktrees with an explicit choice: trust only the selected checkout, or trust the Git project including its current and future registered worktrees. Present the user experience for review before implementation. Trust governs project-local Pi resources that may execute code; it does not authorize Git writes or file access.

## Plan Relationship

This supersedes the unmerged `feat/trust-agent-created-worktrees` behavior, including its old `git_workspace_start` hook (removed on current `rst-main`). The active `2026-09-29_policy-driven-git-tools-plan.md` removes a separate managed Workflow system; this plan changes only project-resource trust and must not restore any removed Git tooling. The obsolete unmerged `feat/trust-agent-created-worktrees` branch, its backup and its earlier scratch checkout remain untouched. Implementation proceeds on `feat/scoped-project-trust` from current local `rst-main`; no integration or cleanup is authorized by this document.

## User experience

1. **Restricted checkout:** Keep the existing restricted-mode banner in the selected chat. Change its action from **Trust project** to **Review trust…**. Do not interrupt browsing or silently trust a new worktree. If no resources require trust, keep the ordinary no-banner experience, but make the scope choices available from a trust-management entry for a Git checkout so the user can decide before resources are added.
2. **Trust dialog:** Show the selected physical checkout path and the Git project identity (main checkout path), with two explicit choices and no preselection:
   - **Trust this worktree only** — project-local resources in this checkout can load; other worktrees still need their own decision.
   - **Trust this Git project (all worktrees)** — project-local resources can load in every registered checkout of this repository, including worktrees created or attached later by an agent or through the sidebar. This is a broader, durable code-execution decision, not just permission for the current branch.
   For a non-Git directory, offer only **Trust this directory**. Cancel leaves the existing restricted state unchanged. Show clearly that this is Pi Web's project-wide scope; the Pi CLI shares only per-path SDK decisions and does not automatically inherit the project-wide grant.
3. **Trust management:** Expose the effective scope in the current checkout's project/settings context even when trusted: **This worktree**, **Git project**, or **Not trusted**. Provide explicit **Stop trusting this worktree** and **Stop trusting this Git project** actions, with clear effect descriptions and confirmation before reducing trust. A worktree explicitly denied under project trust remains restricted; show **Override: this worktree is not trusted** and offer a separate action to clear that override. Never describe a project-wide grant as a per-worktree grant.
4. **Switching/creation:** A worktree created or attached by any path gets no implicit grant from the creator's checkout. A project-wide grant applies to its registered physical checkout automatically on first use; a worktree-only grant does not propagate. Switching to a new untrusted checkout displays the ordinary banner when gated resources exist. If changing scope would affect running sessions in any involved checkout, refuse with a clear wait/stop message rather than partly changing the decision; settled sessions reload resources and model lists after a successful change.

## Architecture and safety

- Keep the SDK's canonical path-based trust store for explicit per-checkout decisions. A separate Pi Web store keyed by the validated physical Git common directory **and a random identity marker created in that directory only on the first project-wide grant** owns the broader grant. This private `.git/pi-web-trust-id` metadata distinguishes replacement repositories even if their directory inode is reused; it is not committed and is not a CLI trust entry. Do not mark a parent directory trusted in the SDK store: adjacent repos or arbitrary directories could otherwise inherit trust.
- Resolve project-wide trust only for existing, registered Git checkout roots of the same repository. Check an explicit per-checkout denial before a project grant; a per-checkout positive decision wins when there is no broader grant. Non-Git directories and subdirectories retain the current path-based behavior. A missing, invalid, replaced, or ambiguous repository identity fails closed rather than matching by name/branch/path prefix alone.
- Use one effective trust decision in every project-resource gate (`getProjectTrustStatus`, SDK reload resolver, plugin/skill/model routes and session startup). Ensure newly added resources trigger the existing gate even when a checkout had no gated resources at the time of grant. Constrain the trust write route to existing allowed directories; do not let a caller supply an arbitrary repository identity.
- A project-wide grant is Pi Web-specific unless the SDK gains a matching repository-scoped facility. Do not silently materialize trust entries for the CLI or claim cross-client propagation. A missing, corrupt or replaced Git identity marker cannot authorize a previous grant; the user must grant trust to the replacement explicitly.

## Plan

- [x] Confirm the two-scope UX and Pi CLI boundary with the user; acceptance: the user chose to replace automatic inheritance after reviewing the proposed experience and requested implementation. Copy/override details remain testable design decisions.
- [x] Design canonical project identity, persistent project-scope store, and explicit checkout-over-project precedence in `lib/project-trust.ts` and `lib/project-trust-repository.ts`; evidence: `lib/project-trust.test.mjs` passes for registered linked/future worktrees, sibling repository, explicit denial and replacement at the same path.
- [x] Extend `app/api/project-trust/route.ts` and shared resource gates to read/write one effective scope; evidence: `app/api/project-trust/route.test.mjs`, `lib/project-trust.test.mjs` and `lib/rpc-manager.test.mjs` pass for grants/revocation, busy starting/descendant sessions, cache/session invalidation wiring, and SDK extension loading after trust.
- [x] Update `components/AppShell.tsx`, `components/ProjectTrustDialog.tsx`, Settings General and translations with two-scope management; evidence: `E2E_TRUST_ONLY=1 npm run test:e2e` passes at 1280px and 390px with a disposable repo and both checkouts, including grant, restriction, clear and revocation.
- [ ] Prepare the replacement feature onto current `rst-main` after committing; this fresh branch starts at `ee623378`, contains no old `git_workspace_start` implementation and adds no implicit trust to browser or agent worktree creation. Recheck target ancestry and verify the exact rebased candidate before integration.
- [x] Update `docs/worktrees.md` and `e2e/README.md`, run focused tests, `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and affected browser E2E without a production build. Evidence at the working-tree checkpoint: 37 focused tests, `npm test` 1,692/1,692, typecheck/lint, and 1280px/390px trust browser tests pass. Earlier full-suite attempts with a full `/tmp` or a symlinked TMPDIR failed for environmental reasons; the normal `/tmp` rerun passed after space became available. Re-run checks if later changes invalidate this evidence.

## Completion Checklist

- [x] User approves the UX and trust boundary before implementation: explicitly requested implementation of the reviewed two-scope plan.
- [x] Both scopes and explicit overrides verified across SDK resource loads, future linked checkouts, route mutation/lifecycle guards, and desktop/mobile browser trust management; evidence in focused tests and `E2E_TRUST_ONLY=1 npm run test:e2e`.
- [ ] Changes are committed on a clean linked feature worktree; local non-FF integration and cleanup receive separate exact-state approvals.

## Rollback / Recovery

Keep existing per-path trust decisions intact while introducing the project-wide store; never reinterpret existing single-directory approvals as repository-wide consent. If a project grant cannot be read or the Git identity cannot be validated, fail closed for that grant. The private `.git/pi-web-trust-id` marker is generated only on the first project grant; revoking removes the grant, not the inert marker. Revoke a project grant without deleting user-owned per-worktree choices; report which checkouts remain individually trusted. Retain the pre-rebase backup and the earlier clean detached scratch checkout for separately authorized lifecycle cleanup, not as implied disposable artifacts of this plan.
