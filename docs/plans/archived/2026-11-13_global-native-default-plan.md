# Global native-tool defaults

## Goal

Allow Session tools to save a global MCP/Code-mode selection for future ordinary chats. Explicit session selection wins over a project default, which wins over the global default; otherwise tools remain off. Existing sessions keep their saved intent.

Implementation and acceptance are complete. Local integration remains subject to the native exact-state approval gate; deployment and remote publication are separate operations.

## Plan

- [x] Extend the private native-default store compatibly with a global selection, independent revisions and shared locked atomic writes; verify legacy files, preservation, conflicts and malformed-input refusal in the native store owner.
- [x] Add inert global metadata/save/reset and ordinary new-session fallback. Admit only eligible global declarations for global saves; verify API security, precedence, snapshot persistence and existing/profile session separation.
- [x] Add global save/reset controls, selection summaries and inheritance guidance in Session tools. Verify actual mounted controls, uncertainty and new-composer inheritance; retain the installed desktop/mobile bridge.
- [x] Review the candidate, run focused checks and complete Nix acceptance, and record input-bound outcomes before exact-state local integration approval.

## Plan Relationship

This extends the delivered native session tools feature. Broader MCP configuration editing, OAuth, profile grants and deployment remain outside scope; no existing active plan owns this default selection.

## Architecture

Current behavior belongs in [Native session tools](../../native-session-tools.md) and [Session contracts](../../session-internals.md). Selections remain in user-owned Brabbler settings, never repository MCP configuration. The existing version-1 project-native-resources document has an optional global selection; old documents remain valid. Both scopes share its lock and bounded private writer, and each revision describes only its own default. Global defaults cannot contain project-scoped server references. Runtime declaration ownership, project trust and Chat-only suppression remain unchanged.

## Verification evidence

- Initial focused native-store/API/mounted-control run: **26 tests passed**, plus static checks.
- A deliberate global-before-project lookup defect failed the new explicit-project-off assertion; **10 passed / 1 failed**, **41 seconds** end-to-end. The defect was restored before further verification. This proves the new precedence test detects an actual runtime regression, not just source spelling.
- Independent review found stale lookup fixture exports and an effect dependency causing automatic metadata reads during Apply recovery. Both were fixed; follow-up review found no remaining blockers. The existing lost-acknowledgement composition assertions remain intact. A subsequent focused run caught only two outdated no-default wording expectations; these now describe global inheritance rather than off.
- Review-fix focused command: `nix run .#test -- core --jobs 4 --file hooks/useAgentSession.native-control-composition.test.mjs --file app/api/native-tools/route.test.mjs --file lib/rpc-manager.test.mjs`: **100 tests passed**, **62 seconds** end-to-end.
- Complete acceptance: `nix run .#test -- all --workers 4 --jobs 4`, source content/mode SHA-256 `48abeac911e6da4ed6e83e8517f73d4002ffc359129f24e68414d7271b810b5b`, based on local main `108be06ea72c50c5465166bf87ce814f123bb422`: **passed**, **459 seconds** end-to-end including realization. This precedes only documentation/evidence archival updates.
- Full scope: **534 core files / 4,628 tests**, type generation/typecheck/lint and bundled plugins; **26 browser/terminal groups**, including global default persistence/inheritance and touch reachability; genuine Home Manager deployment VM, including converter coverage. No skipped, cancelled or failed core tests; no reported surviving observed processes or uncertain settlement.
- Requested/effective widths were **4 core / 4 browser**, with overlap admitted on x86_64 Linux, Node 24.22.2, 32 CPUs and approximately 37 GiB available memory. Twelve/four overlap requires an estimated 43 GiB, so four/four was selected without bypassing admission.
- Browser prerequisite preparation: **85.148 seconds**; browser group execution window: **253.647 seconds**. Core level: **422.359 seconds** including realization; inner pipeline: **420.162 seconds**. Deployment level: **113.584 seconds** including realization, with the VM script **53.70 seconds**. These overlapping intervals are not additive or cold-cache benchmark claims.
- Retained core result: `/nix/store/kc5dz00aii5zi2xqq27r14kvqib9zpnz-brabbler-core-checks`; native browser capsule: `/nix/store/7q8m0w20j3x5i9501hglm9agjfnrv2c6-brabbler-browser-native-tools-diagnostics`. Private task evidence retains command logs, original failures and all-level manifests outside the repository.

## Rollback / Recovery

Clearing a default affects only future ordinary chats, not captured session intent. Explicit session off bypasses defaults, including a broken default lookup. Unconfirmed writes require metadata refresh rather than automatic replay. Clearing a project default can enable the global selection; save explicit off to opt out instead. A replaced global declaration refuses rather than substituting a project server or a lower-priority default. No host deployment or remote publication is implied.

## Completion Checklist

- [x] Store/API/mounted controls and native desktop/mobile bridges pass with no unresolved review blockers.
- [x] Full core/static/plugin, browser/terminal inventory and genuine deployment VM acceptance pass on the candidate.
- [x] Maintained native/session guides describe precedence, scope and recovery; exact-state local integration is separately gated rather than claimed as completed here.
