# Brabbler — Development Instructions

<!-- project-workflow-align: baseline-v3 -->
## Project Git Profile

The global `git-worktrees` skill owns feature history, rebasing, verification,
exact-state approval, remote boundaries, and cleanup. This repository makes
worktree isolation, the local integration target, and method mandatory below;
all other lifecycle safeguards remain in force.

- **Canonical instruction owner:** `AGENTS.md`; there are no harness-specific instruction files that need delegation.
- **Worktree isolation (required):** Make every repository change on a dedicated feature branch in a linked worktree, starting from the current local `main`. The primary checkout is for approved integration only, never direct feature edits. If an existing linked worktree already fits the task, work there; do not create another just for this rule.
- **Local integration target (required):** Integrate completed work into local `main`. Rebase on its current local tip, verify the exact candidate, and obtain exact-state approval before integration. If blocked, retain the feature resources and resolve the blocker rather than bypassing safeguards.
- **Local integration method (required):** Use an ordinary unsigned **non-fast-forward merge**. Do not fast-forward or squash into `main`. Remote publication and feature-worktree cleanup remain separate approvals.
- **Commit signing and authorship:** No project-specific signing or identity requirement; the global lifecycle applies.
- **Required verification:** Follow the single baseline and change-dependent acceptance matrix in [docs/testing.md](docs/testing.md). Complete acceptance comprises sandboxed core/static/plugin checks, the full browser/terminal inventory in ordinary Nix sandboxes, and the genuine Home Manager deployment NixOS VM check. Fresh entry points execute the same definitions; focused passes are not full acceptance. No additional npm baseline, development-server acceptance or non-Nix fallback is required or supported. Production package builds for verification are allowed only inside isolated Nix builders; never run `next build` or `npm run build` in a working checkout or build against the installed service.
- **Publication constraints:** [docs/release.md](docs/release.md) owns the release process. GitHub pushes/releases and npm publication require separate, explicit authorization for the exact remote operation.
- **Planning workflow:** [.agents/skills/writing-plans/SKILL.md](.agents/skills/writing-plans/SKILL.md) owns plans under `docs/plans/`; durable decisions belong in `docs/adr/`, and current operational or contributor behavior belongs in the focused guide under `docs/` or `README.md`/`AGENTS.md`.
- **Intentional deviations or incompatible rules:** The required linked worktree, `main` target, and non-fast-forward merge replace the global lifecycle's optional direct-checkout, alternative/no-target, and fast-forward/squash choices for this repository. Keep its inspection, clean-state, verification, exact-state approval, remote boundary, and separate cleanup safeguards. Preserve the isolated-build boundary above.

Do not copy the global lifecycle into this section. If another applicable rule
conflicts with these project requirements, stop before mutation and ask which
rule applies to the bounded task. A task-specific answer does not rewrite this
profile.

## Prepare and verify

From the selected Linux worktree:

```sh
nix develop                         # prepares checkout-local writable dependencies
npm run dev                         # manual development, port 30141; see lifecycle below
# Automated checks require no shell/dependency preparation or manual server:
nix flake check --max-jobs 1 --cores 4 -L
nix run .#test -- all --workers 4 --jobs 12 # normal fresh full acceptance, if overlap admitted
nix run .#test -- core --file lib/worktree.test.mjs
nix run .#test -- e2e --group markdown
nix run .#test -- service
```

The shell reuses matching Nix-managed `node_modules`; do not run `npm ci` over it,
symlink another checkout's dependencies, or rewrite its marker to bypass a
refusal. First-time dependency preparation can require downloads; add
`--offline --no-write-lock-file` to `nix develop` for cached local-only entry.
Dependency derivations and `next typegen` are not production application builds.
[README.md](README.md#development) owns deliberate Nix/dependency updates.

Use focused checks while editing, then complete acceptance once source and review
changes settle. Record the candidate, command/selection, result and artifact path.
Rebase/relevant input changes require reassessing and verifying the resulting
candidate; a new commit ID alone is not a reason to repeat unaffected application
checks. Do not bypass configured Git checks or relabel older evidence as a new-tip
run. Evidence/status-only follow-ups use the global skill's proportional checks.

One owner coordinates dependency preparation, source export and acceptance budgets.
Pause source writers during export; snapshot-based runs then use immutable input
identities, not subsequent edits. Independent invocations may share a worktree,
but their worker limits are not machine-wide reservations. For fresh full acceptance,
use explicit `all --workers 4 --jobs 12` when available resources and coordinated
concurrent work admit overlap (currently estimated at 32 CPUs / 43 GiB available).
Use `all --workers 4 --jobs 4` if twelve core workers would serialize the levels;
do not carry a focused run's two-worker budget into full acceptance by habit.
Before using fewer workers, state the concrete resource or concurrent-work reason
and record requested/effective widths with the evidence.
Read-only review alone is not a reason to halve acceptance concurrency. Follow
[Testing](docs/testing.md#coverage-and-resource-admission) for admission and runner
defaults. Keep ordinary browser/SDK acceptance separate from deliberate concurrency
tests; do not hide contention with longer deadlines. Never append Node concurrency
flags to `npm test`.
Report end-to-end command runtime (including in-run realization), preparation and
test-execution intervals separately where available, apart from model work and
coordination. Do not compare a cold/preparing run directly with warm-prerequisite
benchmark time.

Delegate only independent work with an explicit checkout, scope, capabilities and
deliverable. Check that the selected profile can produce that deliverable; a
read-only researcher cannot write patches or run checks. Reuse findings instead
of delegating fixture discovery again. Preserve one repository writer and useful
independent safety review; do not require delegation or a durable plan for a small,
obvious change. Keep one receiving candidate and a small work-in-progress limit;
plans own current blockers/decisions, not per-run chronology. Distinguish verified,
implemented-but-unverified, proposed and abandoned work. Reuse unchanged evidence
and review findings; agent-selected packet/control/report conventions are not new
requirements. The planning skill owns package gates and stop conditions.

## Browser and dev-server lifecycle

- **Manual development:** before starting, run `lsof -nP -iTCP:30141 -sTCP:LISTEN`; identify the checkout/process and reuse a healthy matching server. Do not interrupt an installed service or a different task's server.
- **Acceptance:** [e2e/README.md](e2e/README.md) owns the fixture lifecycle. Browser/terminal acceptance uses one ordinary Nix sandbox per whole group and the installed production launcher; the separate small restricted-network NixOS guest proves the real Home Manager user service. Neither uses the host service or checkout's `.next`; there is no development-server or in-place fallback.
- A browser-only `Module ... factory is not available` overlay may be stale HMR. Explicitly reload the page, then compare current server logs and a direct HTTP/API request. Restart only after a fresh page and server-side checks corroborate failure. Stop the exact owned dev process gracefully, retain `.next` in a `mktemp -d` backup, then use `npm run dev`. No webpack fallback.
- Diagnose failures from the exact run's logs, responses, traces and observed process events. Preserve failures before a justified retry; a passing unchanged retry does not prove a fix. Do not suppress general console/5xx errors or inflate deadlines to manufacture acceptance.
- [docs/testing.md](docs/testing.md#diagnostics-and-retention) owns bounded current-run bulk cleanup after settlement and retained evidence. Historical roots, failed builds, checkout dependencies and backups still require separately authorized cleanup; no wildcard/age-based reapers.
- Next.js may append a generated `BEGIN:nextjs-agent-rules` block to this file. Check `git status` after starting a server and exclude generated tooling output from unrelated commits.

## Read the relevant implementation guide

These are task-scoped references, not extra context to load for every change.
Read the relevant sections **before modifying that area**, and update the owning
guide rather than growing this instruction file with another feature narrative.
Code paths in the guides are relative to the repository root.

| Area | Guide |
| --- | --- |
| Architecture, complete source map, CSS variables | [Architecture](docs/architecture.md) |
| Session lifecycle, fork/branch, exact prompts, streaming, relocation, subagents, JSONL | [Session contracts](docs/session-internals.md) |
| Model scoping/catalogs, defaults, titles, provider accounts/auth | [Model/account contracts](docs/model-internals.md); [session speed](docs/model-speed.md) |
| Activity/stars, files/security/editing, skills/plugins, authentication, sound | [Feature contracts](docs/feature-internals.md) |
| Worktrees, Git Explorer, immutable diff/context review | [Worktrees](docs/worktrees.md); [feature contracts](docs/feature-internals.md#git-explorer) |
| Optional Git tools, policy, approvals, operation receipts and cleanup | [Git plugin](docs/git-workflow-plugin.md); [feature contracts](docs/feature-internals.md#git-operations) |
| Browser questions, blocking cards and interaction receipts | [Questions](docs/questions.md); [feature contracts](docs/feature-internals.md#browser-native-ask_user) |
| Authoring or revising guided review notebooks, historical references and saved answers | [Review notebooks](docs/review-notebooks.md) — read before authoring or changing notebook material |
| Terminal behavior | [Terminal](docs/terminal.md) |
| Adding or moving tests, owner recipes and assertion dispositions | [Writing tests](docs/test-writing.md) |
| Verification and browser fixtures | [Testing](docs/testing.md); [browser/terminal acceptance](e2e/README.md) |
| Interface messages, demo and release | [English messages](docs/i18n.md); [demo](demo/README.md); [release](docs/release.md) |

Cross-cutting invariants: keep credential/account bindings session-local and
fail closed; preserve the single path-security boundary and Windows/UNC identity;
never substitute current files for immutable Git snapshots; keep Git semantics in
the optional plugin, not generic chat. A saved decision or receipt is neither new
authority nor proof of execution success. Preserve these boundaries when following
the linked implementation details.
