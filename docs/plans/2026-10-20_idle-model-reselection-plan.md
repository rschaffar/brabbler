# Apply saved model definitions by explicit idle reselection

## Goal

Apply saved model-definition edits when the user explicitly selects a model again, preserving session-local accounts, provider identity, speed/thinking, native overrides and durable selection. Implementation authorized in this session after the read-only assessment. No remote publication or installed-host deployment is authorized.

## Context and Plan Relationship

- Base `rst-main`: `1fe0a04c2d6d11e0c301457e379289d3a61f1508`.
- Branch `feat/idle-model-reselection`; isolated worktree `/home/robert/projects/3rdparty/pi-web-worktrees/idle-model-reselection`.
- Upstream lead `0347c5d4409ca7400c23b77f99a154f24700fcac`, inspected through cached `7c0778a8bc7342f1ededc6f5fb190dc6f4e43044`. Port behavior, not upstream's omitted busy lock or swallowed refresh failure.
- User chose visible refusal while a sharing session is busy, and visible failure rather than cached success after refresh failure.
- Existing archived upstream-followups evidence did not implement runtime refresh. Ordinary resource `/reload` remains resource-only; native SDK 1.3 `ModelRuntime.refresh({allowNetwork:false})` does reread definitions, but does not rebind existing session/scope model objects.
- Model/session guides own ongoing contracts; existing account, session-launch and enabled-model ADRs retain authority. Parent is sole writer/test coordinator; independent reviewers are read-only.

## Non-Goals

No automatic refresh on save, timer, resource `/reload` rebinding, resource-listing optimization, provider network refresh, SDK/toolchain/dependency/pin changes, live credentials/provider calls, installed-service probes or deployment. Do not inspect unrelated Claude/trust branches.

## Plan

- [x] Establish host-owned shared-runtime mutation/admission and failure-settlement boundaries; confirmed with gated and native SDK regressions, including retirement and Chat-only survivor repair.
- [x] Add active-row reselection only where explicitly wired by the composer, preserving other selectors and compaction/busy disabling; composer unit and real desktop/mobile reselection evidence below. Full inventory also owns the added history/compaction assertion.
- [x] Refresh offline and rebind changed models/scopes through public SDK APIs; focused native evidence covers unchanged writes, same-ID thinking, selected accounts, shared siblings and model speed.
- [x] Preserve canonical durable model selection and stale request/session guards, including lost acknowledgements and malformed/removed definitions; actual callback/loader regressions cover pending creation, superseded reads, fresh client coalescing bypass and metadata recovery.
- [x] Add focused native SDK synthetic lifecycle/definition/payload tests and installed-browser coverage, without live model calls; focused evidence below is not full acceptance.
- [x] Update maintained model/session guides and user-facing instructions; two read-only reviewers identified concrete boundary/UI issues, now resolved with regressions. The latest lost-ack metadata and Chat-only repair follow-ups passed focused checks.
- [ ] Commit coherent reviewed changes, reassess/rebase current local target, and run complete fresh Nix core/static/plugin, all browser/terminal and genuine deployment-VM acceptance. Record candidate, input identity, commands, failures, runtime and artifacts.
- [ ] Deliver the clean verified candidate to the Git lifecycle's completion decision and exact-state non-FF merge approval; separate cleanup remains separately gated.

## Implementation and focused evidence

The implementation uses existing account-bound runtimes and explicit runtime-family ownership through speed views. Public SDK effect/context adapters protect direct extension turns and nested tools; replacement-runner guards install before reload session_start. Only synchronous tool-registry changes are allowed during native model_select binding. Failed application triggers full offline repair and all-member model/scope reconciliation, not cached success. Shutdown waits actual binding settlement. Metadata-only model/thinking selections persist and reopen without SDK message-presence fallback. Composer generations protect canonical/metadata reads; client-only `fresh` bypasses old coalesced reads without adding backend external-write probes.

- `nix run .#test -- core --jobs 4` with eleven explicit affected files passed **146 tests / 11 files**, including static preparation, in **211 seconds command wall time**: `/tmp/pi-web-model-reselection-core.cdbZmW.log`, `/tmp/pi-web-test-core.vCwNxo/run.json`. Outer digest `577156eeccdf58b6feb1f003d561e9d066187b33a2d48c1332b6f34d1cff29c4`; snapshot `/tmp/pi-web-test-source-IEUaHm`. This includes realization/queueing and is not a warm execution benchmark.
- Real installed `nix run .#test -- e2e --group markdown` passed both desktop/mobile chains in **150 seconds command wall time**, capsule **125.177 seconds**: `/tmp/pi-web-model-reselection-browser.6tBxlC.log`, `/tmp/pi-web-test-browser.zuHAsZ/run.json`, snapshot `/tmp/pi-web-test-source-UtzvzR`, digest `ef0b70f1d7a12e5422d5bd40c4900ac70690baec67a036b466a67ae95b09e3a0`. It proves same-row application, unchanged transcript, live context limits, thinking maps/capability menus and retained save/resource-reload distinction. Later failure-path-only follow-ups belong to the checks below/full acceptance, not this older run.
- Final review follow-ups passed **4 files / 25 tests** with static preparation in **70 seconds command wall time**: `/tmp/pi-web-model-reselection-final-focused.bWlgWA.log`, `/tmp/pi-web-test-core.WAXb27/run.json`, snapshot `/tmp/pi-web-test-source-tuXXDs`, digest `83a177702ae3042f3526ed0e6c510398f2ef2921b7e574db7ca5e8830ba8e47d`. A placement-only follow-up keeps the speed adapter itself byte-for-byte unchanged and wraps its views at ordinary/subagent service construction instead. That resulting runtime layer passed **4 files / 21 tests** plus static preparation in **60 seconds command wall time**: `/tmp/pi-web-model-reselection-layering.KvHACy.log`, `/tmp/pi-web-test-core.Q1sz2H/run.json`. Complete acceptance below owns the final rebased candidate.
- Independent read-only review covered runtime/account/SDK effects and UI/persistence separately. Corrections include full-family repair, removed-selection retention, unrelated-current scopes, replacement tool contexts, tool-selection callback compatibility, native retirement ordering, pending composer serialization, live/capability reconciliation, lost acknowledgements and unbound Chat-only repair. Native tests use only synthetic credentials and stop payload construction before HTTP.

### Retained iteration failures

No unchanged retry, force click, increased deadline, skipped scenario or general error exemption was used. Failed evidence remains retained; no historical artifacts were cleaned.

| Log under `/tmp/` | Observed failure and correction |
| --- | --- |
| `pi-web-model-reselection-core.43y4Hw.log` | Native registry lookup returns equivalent objects, not a reference-identity guarantee; assert deep metadata equality and replacement of the old scope object. |
| `pi-web-model-reselection-core.4ygg72.log` | Metadata-only reopen lost thinking because SDK restoration keys off messages; explicitly restore persisted model/thinking entries. |
| `pi-web-model-reselection-core.PUDYQA.log` | SDK context thinking is typed string; validate the saved level before passing the native union. |
| `pi-web-model-reselection-core.CvrqKB.log`, `pi-web-model-reselection-native.iZj1na.log`, `pi-web-model-reselection-native.9f59us.log` | Repair fixture directly restored an unnormalized partial cost draft; restore the actual valid writer-produced bytes. Invalid-schema refusal was correct and retained. |
| `pi-web-model-reselection-gate.TH3ToP.log` | Update stale startup source contracts; retain clone replacement error priority over generic shutdown refusal (its fixture cleanup error had masked the failed assertion). |
| `pi-web-model-reselection-core.QKxzfC.log` | Preserve mount-only external-write probes by separating client-only fresh reads from backend force. |
| `pi-web-model-reselection-core.Gl2xsi.log` | Chat-only does not require extension UI binding; retain that lifecycle while excluding unfinished ordinary siblings. |
| `pi-web-model-reselection-browser.UrkNPM.log`, `pi-web-model-reselection-browser.qtddXd.log` | Bind response checks to the actually selected session; explicitly enable the synthetic provider through the minimal-edit API (speed setup intentionally scoped the picker to two other providers). Join click/response lifetimes. The first failed builder had uncertain inner settlement and remains retained. |
| `pi-web-model-reselection-browser.eHcUNt.log` | An offscreen mobile sidebar row still satisfied isVisible; use the real Hide sidebar control, never force a click. |
| `pi-web-model-reselection-browser.QxYMel.log` | Mobile More controls overlapped the model trigger; collapse through its actual control before reselection, reopen for rendered reasoning assertions. |

### Rebase and compatibility

After the user selected local integration following acceptance and explicitly requested rebase, the conflicted attempt was aborted, the clean `c6216741abe047776f2027847a05d74dbef7df98` feature restored, and backup `backup/idle-model-reselection-before-rebase-20261021-033316` retained. Rebase onto current local `rst-main` `176441bf446afc6d5aa95d3fc6f8aa77520ef8f6` produced `208b5fb3b799d453a574a210d83491543e622fa7`. Mechanical resolutions preserve incoming history-only guards, child disposal, all browser scenarios and the existing Models error footer; its existing instruction key now describes idle reselection. Incoming managed-context, resource-listing, subagent-lifecycle and composer-focus work is not part of this feature's scope and is retained. SDK/Node/Next/Nix pins are unchanged.

The rebased `core --jobs 4` selection of twelve affected files passed static preparation and **186/187 tests** in **56 seconds command wall time**; the sole failure was a source assertion still requiring direct speed-wrapper assignment rather than the new outer runtime-access wrapper. Evidence: `/tmp/pi-web-model-reselection-rebased.oKLWTN.log`, `/tmp/pi-web-test-core.HfZtJ5/run.json` (exact file selection retained). Strengthening that assertion to require both wrappers passed `nix run .#test -- core --jobs 4 --file lib/subagent-runtime.test.mjs`, **10/10 tests** plus static preparation, in **53 seconds command wall time**: `/tmp/pi-web-model-reselection-rebase-assertion.33xXIn.log`, `/tmp/pi-web-test-core.AT0eIV/run.json`. No application source changed for that correction. A further strictly read-only compatibility review found no additional rebase-specific regression. Complete acceptance remains pending; earlier focused evidence is not complete rebased-candidate acceptance.

### Second rebase and cooperative Pause composition

The next requested rebase retained backup `backup/idle-model-reselection-before-rebase-20261021-041715` at `6b81fd18a675ac39b18ca66ff6ccd9826896b047`, then replayed onto local `rst-main` `c1a1ae5f3e7ea6c868e170723aad5d23528edce0`, producing `5b461fce66ab4fea02c8ac15a036a1cf6020d840`. Additive conflicts preserve cooperative Pause fields, imports, busy/admission checks and documentation alongside model-refresh ownership. Five focused files initially passed **105 tests** plus static preparation in **57 seconds** (`/tmp/pi-web-model-reselection-pause-rebase.UaEpCh.log`, `/tmp/pi-web-test-core.QQnC4p/run.json`).

Independent review then found a semantic composition defect: Pause requested during an unchanged refresh had no settlement wake-up and could remain Pausing. The user explicitly approved fixing this before merge. The shared-runtime owner now notifies every alive member only after actual refresh/bind settlement, including failure and late post-timeout completion. RPC reconciles Pause, not successful-run completion; child-settled publication also respects shared refresh. Observer failures cannot block sibling reconciliation or change the refresh outcome, and do not expose diagnostic details. Paused context persistence retains the fail-closed model gate.

Native shared-runtime regressions cover success, failure, timeout/late settlement, child-settled exclusion and pause-ingress gate retention. The first fixture attempt lacked host extension initialization and timed out (`/tmp/pi-web-model-reselection-pause-red.xB5ZoN.log`, `/tmp/pi-web-test-core.Rrp1pu/run.json`, **664 seconds**); it is not behavioral red evidence. With explicit initialization, all three new cases failed at the expected Pausing-versus-Paused assertion while the original 32 passed (`/tmp/pi-web-model-reselection-pause-red-bound.v90Gtx.log`, `/tmp/pi-web-test-core.O5BDYm/run.json`, **652 seconds**). Both attempts also exposed a fixture clock-ownership leak: real ten-minute wrapper timers were created before timer mocking, then cancelled through mock clearTimeout. Mocking now starts before wrapper creation and remains active through cleanup; no deadline or idle policy was relaxed.

The corrected source passed `nix run .#test -- core --jobs 4 --file lib/session-pause.test.mjs --file lib/session-model-refresh.test.mjs --file lib/rpc-manager-model-config.integration.test.mjs --file lib/subagent-runtime.integration.test.mjs --file lib/rpc-manager.test.mjs`: **5 files / 109 tests**, zero failed/cancelled/skipped, plus static preparation, in **57 seconds command wall time**. Evidence: `/tmp/pi-web-model-reselection-pause-green.Bq9N7P.log`, `/tmp/pi-web-test-core.3ipium/run.json`. Complete acceptance remains pending.

## Risks and Recovery

SDK refresh is not transactional and cancellation is not rollback. Never admit a run merely because a timeout response returned while refresh is still executing. Partial failure must remain visibly unavailable until a successful safe refresh or deliberate reconstruction. Native provider/extension callbacks are not sandboxed by `allowNetwork:false`. Preserve immutable account/store binding and shared-subagent safety, not just the selected wrapper's idle flag. No persistence migration is intended; reverting code does not revert user-saved definitions.

## Completion Checklist

- [ ] Explicit reselection behavior and failure/busy choices have meaningful focused/native/browser evidence.
- [ ] Complete Nix acceptance and independent review pass for the settled source; earlier failures remain recorded.
- [ ] Maintained guides own durable semantics, and exact local integration/cleanup results are distinguished from implementation evidence.
