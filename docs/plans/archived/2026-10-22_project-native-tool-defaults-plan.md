# Project native-tool defaults

## Goal

Add browser-managed project defaults for native MCP selection. The user requests
repository-wide defaults shared by linked worktrees, and Paperless enabled for
new ordinary buchhaltung sessions after implementation/deployment. Existing
sessions, subagents and agent-launched sessions must remain unchanged. Underwrap,
Paperless permissions and native definition-identity admission remain intact.

## Plan Relationship

Extends the completed reduced native-session-tools release without importing the
parked whole-configuration/OAuth/Nix-management project. The maintained owner is
`docs/native-session-tools.md`; native `mcp.json` declarations remain external.
The global Git lifecycle owns integration/cleanup. No broker calls or document
operations are needed for implementation or acceptance.

## Plan

- [x] Resolve scope: repository plus linked worktrees; initialize Paperless only
  for future ordinary buchhaltung sessions after deployment. Existing sessions
  and children remain unchanged.
- [x] Create/index linked worktree `feat/project-native-tool-defaults` from local
  main `2c476b00fe9d980b6281a66d6c578610cdea1619`.
- [x] Implement a private, versioned, locked project-default store with fresh
  project identity, bounded validation, replacement-project isolation and no
  connections or configuration/credential exposure on read/save.
- [x] Add path-authorized metadata/save/reset API and Session tools controls with
  clear new-session-only semantics, explicit overrides and honest error recovery.
- [x] Resolve defaults only for fresh ordinary creation, persist the selected
  snapshot once, and preserve explicit off, existing intent, Chat-only suppression,
  trust, exact declaration scope, launch/child and fork/clone behavior.
- [x] Add unit/API/lifecycle and installed desktop/mobile browser regressions for
  save/reset, repo/worktree sharing, new-session inheritance, explicit off and
  unchanged existing/child sessions.
- [x] Obtain independent safety review; update the maintained guide and resolve
  relevant findings before final source export. Reviewer identified synchronous
  Git probes outliving the default stale-lock interval: replaced that assumption
  with a 120s lease and 30s monotonic/wall write-budget fences. Regression refuses
  an expired snapshot and preserves a later write. Follow-up found no remaining
  blocker under ordinary scheduling; arbitrary suspension during atomic writing
  remains a general lease limitation. Also reject valid-shaped save acknowledgements
  whose normalized selection contradicts the requested save/reset.
- [x] Run focused checks during editing and complete core/static/plugin, all
  browser/terminal and genuine Home Manager VM acceptance on settled input. Final
  corrected/rebased full evidence is below.
- [x] Prepare reviewable commits and rebase to current local main. Final exact-tip
  approval/integration remains owned by the global Git workflow/tool receipt; this
  source plan records readiness, not authority or a fabricated merge result.
- [x] Hand off reviewed deployment and the approved buchhaltung setting to the
  explicit deployment owner: Nix repository plan
  `docs/plans/2026-10-22_pi-web-project-defaults-deployment-plan.md`, worktree
  `/home/robert/nix/my_nix_os-worktrees/pi-web-project-native-defaults`.
  Its activation/default checks remain open; no live setup is claimed here.

## Focused evidence

- Initial focused core failed before tests on the missing nativeResources field in
  the hook's AgentStateResponse type: 19s, `/tmp/pi-web-project-defaults-focused.xYVM7c.log`.
  A later fixture failed because its mutating requests omitted the required Host
  header: 55s, `/tmp/pi-web-project-defaults-focused.8xlCBW.log`. Fixed the type and
  fixture; no host/origin checks were weakened.
- Focused six-file run passed 64 tests plus typegen/typecheck/lint/exporter checks
  in 57s: `/tmp/pi-web-project-defaults-focused.Lh2PKo.log`,
  `/tmp/pi-web-test-core.TiWwYZ/run.json`.
- Installed production desktop/mobile native-tools scenario passed in an ordinary
  Nix sandbox: 116s command including isolated production realization, capsule
  19.998s. `/tmp/pi-web-project-defaults-browser.V7yAog.log`,
  `/tmp/pi-web-test-browser.aWNK4C/run.json`. This predates the later store lease
  correction and stronger contradictory-ack assertion; not final acceptance.
- Reviewed focused seven-file run passed 88 tests plus static/exporter checks in
  68s: `/tmp/pi-web-project-defaults-reviewed-core.fvZzw5.log`,
  `/tmp/pi-web-test-core.ifc7Hu/run.json`. Includes real native lifecycle and lease
  regression; before the final one-line ack equality check. All are focused only.
- All checks use isolated Nix source exports, synthetic data and no live host
  service, provider or Paperless calls. Two pre-existing ReviewFileBrowser lint
  warnings remain.

### Pre-rebase acceptance and fixture correction (superseded)

The first full command on `6159769` exited 1 after 428.376s. Complete core passed
400 files / 3,010 tests, while the model-speed desktop browser chain failed after
clone/fork. Exact trace `z91hzy3wfmz5fn4q32n56ljvnl4xqgnr` showed a forced catalog
response landing between click-coordinate calculation and dispatch: B moved from
index 1 to 4, by 162px. The fixture now waits for both returned copy IDs in the
sidebar DOM before its original single click and URL assertion. No retries,
force-clicks, changed speed assertions or longer deadlines. Independent trace
review confirmed the bounded synchronization gap and correction.

- Failure: `/tmp/pi-web-project-defaults-all.qbLuXk`; full core report
  `/tmp/pi-web-test-core.9sRYYL/run.json`. Focused corrected model-speed passed
  56s / capsule 41.416s, `/tmp/pi-web-project-defaults-model-speed.7I1IYd.log`.
- Separate complete browser run on `d1404d6` passed all 26 groups/57 chains in
  382.942s with four workers: `/tmp/pi-web-project-defaults-complete.EaPmfK/browser.log`,
  `/tmp/pi-web-test-browser.iusDsV/run.json`. Genuine VM passed in 65.118s,
  guest script 20.73s: that root's `service.log`, `/tmp/pwv-KmdisR/run.json`.
- Final fixture static/core selection passed four files / 32 tests in 92s:
  `/tmp/pi-web-project-defaults-fixture-core.OjS2ba.log`.

### Requested rebase and integration correction

The user requested another rebase. It completed without conflicts onto local
main `b1a4a19e6b1aace800f4238e126ef258295b96fb`, producing `1772b3a` and `ef9d7d5`.
New main adds the acceptance coordinator and changes runtime/package inputs, so
pre-rebase acceptance above is not final evidence for the combined candidate.

Source review found that initializing the trust identity during a default save
would rename the new coordinator's project identity and strand profiles/jobs.
The correction uses a separate, domain-separated `pi-web-native-resources-id`
marker. Default saves do not create the trust marker, and later explicit trust
grants do not rename native defaults. Existing trust APIs retain their behavior.

- Regression red: exactly the new acceptance-identity assertion failed (8/9
  passed), 49s; `/tmp/pi-web-project-defaults-identity-red.PzJJyM.log`.
- Corrected focused green: five files / 39 tests plus static checks passed in 58s;
  `/tmp/pi-web-project-defaults-identity-green.kUxahi.log`,
  `/tmp/pi-web-test-core.ylL9mg/run.json`.
- The in-progress rebased full run used the prior identity code and was deliberately
  superseded. Its exact owned controller received SIGINT and both drivers settled;
  retained `/tmp/pi-web-project-defaults-rebased-all.fYlH6u`, 202.684s, exit 1.
  It is interrupted evidence, not a product failure or acceptance pass.

## Complete acceptance of the corrected rebased candidate

Candidate `2e906d007c8a2603b798c5d2c603a549592c0db4`, based on local main
`b1a4a19e6b1aace800f4238e126ef258295b96fb`, passed:

```sh
nix run --offline --no-write-lock-file .#test -- all --offline --workers 4 --jobs 4
```

- Whole command: **529.754s (8m50s)** including in-run realization, exit 0;
  `/tmp/pi-web-project-defaults-final-all.CVMtqR/{run.log,result.txt}`.
  Source `/nix/store/2dwpam00yf6wianqsnsd90gsb1k0sas4-source`, digest
  `1d38794afb1cd9396f1e4685f786aac1c7268a43bd3504d8f4e3a11017e2a0e4`.
- Core/static/plugins: **405 files / 3,043 tests / 12 suites**, all pass, no
  skipped/cancelled cases or observed survivors. Requested/effective jobs **4/4**;
  driver 409.441s, lifecycle before-first-file/static interval 44.924s and file-test
  window 362.805s. `/tmp/pi-web-test-core.9Mx1x7/run.json`, immutable output
  `/nix/store/jls7wfzhmy7wgq402xw7rnp1g9n8nc11-pi-web-core-checks`.
- All **26 browser/terminal groups / 57 scenario-input chains** pass at four
  sandboxes; each capsule reports settled owned resources, empty errors and closed
  port. Driver 453.828s, preparation to first capsule 94.521s, capsule window
  359.181s (includes later group realizations). Native tools: 15.302s.
  `/tmp/pi-web-test-browser.gFv5ML/run.json`.
- Genuine restricted-network Home Manager VM passed: driver segment **70.318s**,
  guest script **20.01s**, fixed one CPU/1536 MiB/2048 MiB disk; generation startup,
  persistence/restart, real PTY and final cgroup/port settlement all pass.
  `/tmp/pwv-km3gUf/run.json`.
- Browser and VM use the **same** installed application
  `/nix/store/lp7y3fn2zg4hwf3fkpl39ib2212cn404-pi-web-0.9.3`.
  Browser admission saw 32 CPUs/about 38.9 GiB available, no competing acceptance run.
  Widths are local estimates, not reservations; overlapping intervals are not
  added. Isolated package preparation is included in command time, not a warm
  benchmark or model/review/coordination time.

Only this evidence/status plan changes after that acceptance. Its subsequent
archive/commit does not relabel the run as executing on a later commit. Final
Git verification must confirm runtime/test/Nix inputs remain identical. No
credentials, host service, live broker or Paperless documents were used. Native
ARM, CI and physical mobile keyboards were not claimed by these Linux/Chromium
fixtures. No host deployment, remote publication or cleanup is implied.

## Rollback / Recovery

Defaults are user-owned Pi Web intent, not project-controlled executable files.
Malformed/missing settings fail closed; configuration availability and trust still
own admission. Saving/resetting defaults never recreates live sessions or grants
new filesystem roots. Existing selection snapshots do not track later default
changes. New sessions can explicitly opt out, and deleting the project default
returns future sessions to off. Do not modify JSONL to manufacture grants.

No production build runs in a checkout, no live host service is used for tests,
and no credentials are inspected. A host deployment/restart is a separate reviewed
operation; Paperless setup must not imply authority for document CRUD.

## Completion Checklist

- [x] New-session defaults work across registered worktrees and nowhere else.
- [x] Existing/explicit-off/child/launch authority boundaries pass regressions.
- [x] Browser save/reset and complete Nix acceptance pass with retained evidence.
- [x] Maintained docs and handoff status are accurate. Actual Git integration uses
  the separate tool gate; deployment/default initialization has the explicit Nix
  plan owner above and remains separately reviewed.
