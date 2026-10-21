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
- [ ] Run focused checks during editing and complete core/static/plugin, all
  browser/terminal and genuine Home Manager VM acceptance on settled input. Record
  identities, commands, widths, preparation/execution/total times and artifacts.
- [ ] Commit, rebase to current local main, verify and obtain exact non-FF merge
  approval through Git tools. No remote publication.
- [ ] Separately arrange reviewed deployment and the approved buchhaltung default
  through the user-settings API/UI; report remaining live steps honestly.

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
  warnings remain. Full acceptance is still outstanding.

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

- [ ] New-session defaults work across registered worktrees and nowhere else.
- [ ] Existing/explicit-off/child/launch authority boundaries pass regressions.
- [ ] Browser save/reset and complete Nix acceptance pass with retained evidence.
- [ ] Maintained docs, integration and approved live setup status are accurate.
