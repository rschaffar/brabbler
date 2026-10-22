# Compact Activity actions: acceptance blockers

## Goal

Finish the user-approved compact right-hand Activity actions, fix only evidence-backed acceptance blockers, then verify and merge into local `main` with separate exact-state approval.

## Plan Relationship

`docs/testing.md` and `e2e/README.md` own acceptance. The historical development-verification plan owns the shared harness architecture, not these two fixture interactions. This task changes neither production privacy policy nor acceptance permissions/recipes.

## Evidence and unknowns

- Compact controls passed focused core/static checks and a full pre-rebase run (`886670b`, `/tmp/pi-desk-compact-acceptance.8qL5rw`, 548s).
- Full acceptance of `599631b` on `main` failed after 491s: `/tmp/pi-desk-compact-final-acceptance.AGgeG6`. Privacy timed out opening Settings at tablet width; Activity later timed out opening the Acceptance profile editor. Neither failure may be erased by an unchanged retry.
- Privacy trace shows a Settings click during the 200ms sidebar width transition, followed by no Settings dialog. Its immutable evidence is `/nix/store/1b1fgg5d7ikf85ml78m9gb9npqlh40cf-pi-web-browser-privacy-diagnostics`.
- Acceptance editor cause remains under investigation; evidence is `/nix/store/k91j8c3xr8p97viiddwalpvir44kchlf-pi-web-browser-activity-diagnostics`.
- Main advanced with notebook highlighting; the layout patch rebased cleanly to `6e06301`. These main changes do not fix either fixture failure.

## Plan

- [ ] Synchronize privacy Settings navigation with actual expanded-sidebar geometry/animation state; add deterministic readiness regressions without retries or longer deadlines.
- [ ] Diagnose the exact Acceptance trace and implement the smallest supported remedy with regression coverage.
- [ ] Run focused core/static and both affected browser groups, preserving failed and passing identities/artifacts.
- [ ] Review settled source, rebase onto current local `main`, coordinate resources, and complete core/browser/terminal/deployment acceptance on that candidate.
- [ ] Move durable fixture guidance to `e2e/README.md`, archive this completed plan, and use proportional documentation verification.

## Completion Checklist

- [ ] Each blocker has concrete evidence, a bounded fix and passing focused verification.
- [ ] Complete acceptance passes for the final relevant source inputs; no failing or interrupted run is relabelled as a pass.
- [ ] Exact candidate is approved and integrated by unsigned non-fast-forward merge; remote operations remain out of scope.
- [ ] Feature cleanup is separately approved or resources are explicitly retained.
