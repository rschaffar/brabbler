# Compact Activity actions: acceptance blockers

## Goal

Finish the user-approved compact right-hand Activity actions, fix only evidence-backed acceptance blockers, then verify and merge into local `main` with separate exact-state approval.

## Plan Relationship

`docs/testing.md` and `e2e/README.md` own acceptance. The historical development-verification plan owns the shared harness architecture, not these two fixture interactions. This task changes neither production privacy policy nor acceptance permissions/recipes.

## Evidence and unknowns

- Compact controls passed focused core/static checks and a full pre-rebase run (`886670b`, `/tmp/pi-desk-compact-acceptance.8qL5rw`, 548s).
- Full acceptance of `599631b` on `main` failed after 491s: `/tmp/pi-desk-compact-final-acceptance.AGgeG6`. Privacy timed out opening Settings at tablet width; Activity later timed out opening the Acceptance profile editor. Neither failure may be erased by an unchanged retry.
- Privacy trace shows a Settings click during the 200ms sidebar width transition, followed by no Settings dialog. Its immutable evidence is `/nix/store/1b1fgg5d7ikf85ml78m9gb9npqlh40cf-pi-web-browser-privacy-diagnostics`.
- Acceptance trace shows the initial status response inserting two profile cards between summary coordinate selection and dispatch; native details remained closed. Evidence is `/nix/store/k91j8c3xr8p97viiddwalpvir44kchlf-pi-web-browser-activity-diagnostics`. The pre-hydration hypothesis was rejected: the component's effect had already opened its modal.
- Main advanced with notebook highlighting and scoped Git approval guards; the two feature commits rebased cleanly onto `32cb74b` as `e61fad5`. These main changes do not fix either fixture failure.
- Focused core/static: 3 files / 17 tests passed in 82s, `/tmp/pi-desk-activity-readiness-core.05tzTC`. Later teardown/poll-proof review changes did not alter the tested readiness predicates.
- Focused browser snapshots share source digest `fd41beb3706a0ee8707fa5b4ef4f16eef2982d3bf57ab8e22f68954324489e96`: Privacy passed in 158s (42.558s group execution), Activity passed in 344s (229.356s execution), `/tmp/pi-desk-activity-readiness-browser.7ZWyUt`. Commands: `nix run .#test -- e2e --group privacy --workers 1` and the matching `activity` selection. These include in-command realization; no claim of cold-cache or machine-exclusive timing.
- Complete acceptance on `e61fad5` plus this evidence-only plan delta used two browser workers/two core workers because another four/four full run was active. `/tmp/pi-desk-compact-fixed-acceptance.cGiuUd` settled after 601s: all 410 core files / 3,082 tests passed, repaired Activity (227.198s) and Privacy (34.409s) passed, but File Edit failed its compact-layout settlement assertion before deployment could run. Evidence: `/nix/store/1svy8la4iz6w5yyxh1vng0frx8qwqxx4-pi-web-browser-file-edit-diagnostics`. No unchanged retry was made.
- Main subsequently integrated the default-off Acceptance plugin and an independently diagnosed fix for that exact File Edit settlement assertion (`d9746ca`). User confirmed the target may now stay stable for reconciliation and final verification.
- Reconciled onto stable `main` `27d66ac6e3012c84002d83c6973e921f59964cf3`. The expected Acceptance fixture conflict was resolved in place with explicit user approval: all disabled/enabled tool, queue and active-job assertions remain, and cleanup independently attempts plugin disable even after earlier errors. Shared `sidebarReady` now protects both Privacy Settings and the newly added Acceptance Settings navigation. Source review found no weakened assertions, retries or deadline increases.
- Reconciled focused core/static passed all 3 files / 17 tests in 44s: `/tmp/pi-desk-compact-reconciled-core.bHSGK6`. Final full acceptance uses four browser/four core workers; no peer acceptance process is active and available memory is approximately 50 GiB on 32 logical CPUs.

## Plan

- [x] Synchronize privacy Settings navigation with actual expanded-sidebar geometry/animation state; add deterministic readiness regressions without retries or longer deadlines.
- [x] Diagnose the exact Acceptance trace and implement the smallest supported remedy with regression coverage.
- [x] Run focused core/static and both affected browser groups, preserving failed and passing identities/artifacts.
- [ ] Review settled source, rebase onto current local `main`, coordinate resources, and complete core/browser/terminal/deployment acceptance on that candidate.
- [ ] Move durable fixture guidance to `e2e/README.md`, archive this completed plan, and use proportional documentation verification.

## Completion Checklist

- [x] Each blocker has concrete evidence, a bounded fix and passing focused verification.
- [ ] Complete acceptance passes for the final relevant source inputs; no failing or interrupted run is relabelled as a pass.
- [ ] Exact candidate is reviewed and ready for separate unsigned non-fast-forward merge approval. Final Git integration/cleanup receipts are reported in chat, not a further plan-writing loop; remote operations remain out of scope.
