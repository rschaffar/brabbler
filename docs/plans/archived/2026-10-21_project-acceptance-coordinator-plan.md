# Project acceptance coordinator

## Goal

Let parallel Pi Web sessions request, observe and share managed acceptance runs for a project without launching competing heavy jobs. Pi Web owns configured execution independently of a waiting conversation. Preserve exact snapshot/evidence identity and honest cancellation/restart state.

## Context

Authorized by the user's “alright. let's do that” after choosing managed execution rather than reservations. Work starts from local main `795280d3c3fe4dd48e51cf7268dbb2a1ff7d22b3` in `feat/project-acceptance-coordinator`. No remote publication or deployment is authorized.

## Plan Relationship

Existing Nix/parallel acceptance plans and ADR 0025 own the repository's test definitions, isolation, inventory and verification. This feature coordinates invocations; it does not widen their concurrency, weaken coverage/deadlines, change Git permissions or replace Nix containment. Session Launch and native-session-tools retain their independent scope.

## Architecture

- Private user-configured named project profiles contain argv, explicit snapshot input roots, CPU/memory estimates and full/focused labels. No arbitrary command argument on model tools; settings are browser-owned. Default run permission Ask, with an explicit user-owned Allow option.
- Physical Git common-directory identity groups registered linked checkouts; ordinary directories are individually scoped. Operation identity additionally binds source manifest, frozen profile, execution platform and execution environment recipe.
- A bounded verified source copier captures declared inputs before queueing, excludes credentials/generated directories, refuses symbolic/special entries and checks changing inputs. Snapshot is private/read-only, not an OS sandbox or secret-content detector. Commands run in their captured snapshot; runtime output goes to separate private state.
- One coordinator per agent directory survives HMR, persists requests/results and owns one heavy execution slot across projects. Cross-process admission must fail closed rather than start a second scheduler. Identical in-flight eligible runs can share observers, never historical successes or differing snapshots.
- Separate result, process settlement and persistence status. Unknown execution/settlement blocks new heavy work until explicit user reconciliation; a timeout or old PID does not release capacity. Restart does not replay queued/running jobs.
- Session tools submit/status/cancel using real SDK caller identity. Request retry keys are idempotent; session Stop aborts pre-admission/wait only, not independently accepted jobs. Shared cancellation is explicit and ownership checked. No automatic completion model turns.
- A project Acceptance dialog exposes configuration, queue/run history, logs, identity, phase timings and explicit cancellation/recovery. Existing file access, trust and request boundaries remain authoritative.

## Plan

- [x] Implement and test profile validation/private configuration, physical project admission and verified snapshot capture; reject malformed recipes, escapes, secrets/generated paths, detected changing/symlink inputs and mismatched project identity. Full acceptance includes the real Nix-template capture/exporter round-trip.
- [x] Implement and test durable coordinator/execution ownership, idempotency, in-flight joins, one-slot FIFO scheduling, cancellation and restart/unknown blocking; verify persistence failure and cancellation never release unproven resources. All 16 coordinator and 3 lock-owner interruption cases passed on the final candidate.
- [x] Add real session-aware tools and authenticated browser API, with profile-scoped Ask/Allow and no model-accessible settings mutation; verify caller/control isolation and request retry behavior. Initial full core passed the three tool/API cases, including caller namespace separation.
- [x] Add accessible project Acceptance configuration/status/log dialog and packaged browser scenario; verify queue/shared status, exact input display and explicit control semantics without invoking real acceptance recursively. Packaged Activity passed all desktop/tablet/mobile variants after fixing the observed initial-load editor race.
- [x] Obtain independent read-only safety review, resolve findings, and update owning guide/ADR/source map. Final narrow follow-up confirmed lock-owner mutation repair closes the last reported blocker; focused 16 scheduler + 3 recovery-process cases passed.
- [x] Freeze candidate, run complete fresh Nix core/browser/deployment acceptance with admitted four/four profile, record command/runtime/input/artifact evidence, then commit and prepare exact-state local main non-FF integration. Candidate `307b8a42961bf1a70c804afe3f355d7f27ce3bec` passed after rebasing onto current main `2c476b00fe9d980b6281a66d6c578610cdea1619`; integration remains a separate exact-state tool approval.

## Non-Goals

Distributed scheduling, control over arbitrary Bash/external CLI runs, automatic historical-result reuse, automatic retries/replay after restart, dynamic CPU resizing, test sharding, blanket sandbox claims, automatic Git integration and artifact garbage collection.

## Risks and Recovery

Profile programs execute trusted project code as the Pi Web OS user, not a new sandbox. Snapshot roots are an explicit content allowance, not a secret scanner. Source writers must pause during capture; detection is not a filesystem transaction against hostile external writers. A cancelled/failed program may leave unknown effects. Retain diagnostics/snapshots and block conflicting admission when settlement is uncertain. User reconciliation must explicitly acknowledge unknown resource ownership, never kill/adopt a saved numeric PID. Disabling the feature does not certify existing jobs stopped.

## Verification evidence (in progress)

- Initial focused core found TypeScript return/environment typing errors; corrected, not bypassed.
- `/tmp/pi-acceptance-coordinator-focused.LER2AC/driver.log`: 75s failed run exposed snapshot file modes masked by the private 077 umask. Explicit chmod now seals the copied mode; `/tmp/pi-acceptance-coordinator-focused.sDGoN9/driver.log` passed 9 scheduler cases plus static checks in 46s.
- `/tmp/pi-acceptance-coordinator-core.nMziVd/driver.log`: full core/static/plugins passed 402 files / 3,013 tests / 12 suites in 364s, zero skips/cancellations/uncertain settlement. Inner evidence `/tmp/pi-web-test-core.zx5nTl/run.json`. This predates final recovery changes; it is not final-candidate acceptance.
- `/tmp/pi-acceptance-coordinator-browser.UqN129/driver.log`: retained 191s failure from ambiguous fixture text matching the recipe instead of its log pane. The assertion now targets the actual log region; no assertion/deadline was weakened.
- `/tmp/pi-acceptance-coordinator-browser.lRT7Bk/driver.log`: retained 276s failure exposed a real tablet initial-status/configuration-edit race. The editor/template/save now remain disabled until initial state is loaded, with an exact draft-value browser assertion. Evidence `/nix/store/6wm78f705fx48xnhp7mgajwa5dm2792l-pi-web-browser-activity-diagnostics` retained.
- `/tmp/pi-acceptance-coordinator-browser.j2jLux/driver.log`: packaged Activity passed all three viewport chains in 330s end-to-end, including in-run production realization; capsule execution 223.562s. `/tmp/pi-web-test-browser.kkU7zX/run.json`, immutable evidence `/nix/store/wag7lw7qj4zsmcmrkprjwwv1ahbj1iqx-pi-web-browser-activity-diagnostics`. Subsequent changes are recovery backend/test changes, not a claim of final complete acceptance.
- `/tmp/pi-acceptance-coordinator-recovery.PsI4bq/driver.log`: 16 scheduler/persistence and 2 initial kernel-lock regressions passed in two focused sandboxed invocations, 111s total including repeated static preparation. A test-local reserved `module` identifier had failed lint in the preceding run and was renamed; lint was not disabled.
- Independent read-only review led to post-verification recipe revocation checks, retry recipe binding, separately retained completed results, frozen versioned environment, serialized-byte budgets, post-rename fsync recovery, and moving all recovery mutations into the kernel-lock-owning process. The earlier helper-held parent callback is explicitly retracted: helper death could release exclusion while the parent continued mutating. Final interruption regressions and complete acceptance remain pending below.

- Final focused recovery: `/tmp/pi-acceptance-coordinator-final-recovery.OSrOxV/driver.log`, two fresh Nix invocations passed 16 scheduler and 3 lock-owning-process cases plus static checks in 138s total. Evidence `/tmp/pi-web-test-core.Star5O/run.json` and `/tmp/pi-web-test-core.Y5vs9J/run.json`. The helper-loss test kills the same process that performs critical writes; the surviving parent performs no unlocked recovery writes.

## Final complete acceptance

Tested feature commit `307b8a42961bf1a70c804afe3f355d7f27ce3bec`, rebased on main `2c476b00fe9d980b6281a66d6c578610cdea1619`. From the physical feature worktree:

```sh
nix run --no-write-lock-file .#test -- all --workers 4 --jobs 4
```

- **Passed in 619s (10m19s) end-to-end**, including in-command production/support and deployment-driver realization. No separate prewarming was performed for this command; pinned dependencies/previous artifacts were already cached. This is not a cold-cache promise or comparison with historical warm benchmarks. Model/review/coordination time is excluded.
- Host native x86_64 Linux: 32 effective logical CPUs; initial admission about 37.9 GiB available. Requested/effective browser 4/4 and core 4/4; combined estimated 16 CPUs / 27 GiB including realization, not an OS reservation. Core overlaps browser followed by deployment; intervals must not be added as serial.
- Outer source content/mode SHA256 `63b027cd01ff4e8ea792e6e95e51c8e9f55837d5b05ba4c54aaa5ea36a014ffe`. Export/selection `/tmp/pi-web-test-source-gEq8Wu/{source.json,selection.json}`. Command log/result `/tmp/pi-acceptance-coordinator-all.rYjVPm/{driver.log,result.txt}`.
- Core/static/plugins: **404/404 files, 3,029/3,029 tests, 12 suites**, zero skipped/cancelled/unstarted cases, observed survivors or uncertain settlement. Level interval 443.193s, including about 45.221s inner preparation before first file and 395.644s test-file execution span. Report `/tmp/pi-web-test-core.dyRQmS/run.json`; immutable evidence `/nix/store/d73ylwkxb3a9mk1mdqf3hk9d72zfg5zg-pi-web-core-checks`.
- Browser/terminal: **26/26 groups, 57/57 exact scenario receipts**, all passed with execution/settlement validation, including this feature's real installed-package desktop/tablet/mobile assertions. Level 509.668s: 98.903s before the first capsule (realization/queue preparation) and 410.561s capsule execution span; small remaining publication overhead. Report `/tmp/pi-web-test-browser.jUrhPK/run.json` retains each exact immutable capsule output.
- Genuine Home Manager deployment: **passed all ordered environment, activation, durable write/restart, paused state, PTY and final service/cgroup/port shutdown proofs**. Level 100.826s includes driver realization; VM test script 24.04s. `/tmp/pwv-12YDne/{run.json,artifacts/acceptance.json}` retains observations/hashes and confirmed outer execution settlement. Fixed guest 1 vCPU / 1536 MiB / 2 GiB sparse disk; not a measured minimum.
- Browser and deployment used the same package `/nix/store/2kii0agd10iqwjcbjgiang0wkvs3dg67-pi-web-0.9.3`. No installed host service, checkout production build, deployment or publication was used.

Evidence/status-only archival follows this tested source. It does not claim the complete suite reran on a later documentation commit. Durable behavior belongs in `docs/acceptance.md`, ADR 0031 and the maintained feature/session/architecture references. Linux-only execution, cooperative control over managed jobs only, mutable non-pinned external toolchains, and no automatic artifact GC remain explicit limits, not unfulfilled implementation promises.

## Completion Checklist

- [x] Focused regressions and genuine packaged browser feature assertions pass.
- [x] All required complete acceptance levels pass on identified candidate inputs; timing and retained artifacts recorded.
- [x] Safety review findings resolved; maintained guide, ADR, feature/session contracts and source map updated. No remaining concrete blocker reported in final scoped review.
- [x] Feature history is reviewable and ready for exact-state approval of the required local main non-FF method. No remote operation performed; integration/cleanup remain separately gated, not claimed by this checklist.
